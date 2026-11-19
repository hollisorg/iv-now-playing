// UI check: launches IV Now Playing with made-up songs (IV_NOW_PLAYING_FAKE=demo) in a throwaway data
// folder, drives the editor and the widget, and saves screenshots. Never touches real settings.
//
//   node scripts/ui-check.mjs <outDir>                      from source
//   node scripts/ui-check.mjs <outDir> --exe "<path>.exe"   packaged app (npm.cmd run dist:dir first)
//   add --real to read this PC's real players instead of made-up songs (read only)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] || 'qa/ui-check')
const exeAt = process.argv.indexOf('--exe')
const exe = exeAt > 0 ? process.argv[exeAt + 1] : null
const real = process.argv.includes('--real')
fs.mkdirSync(out, { recursive: true })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivnp-ui-'))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const get = (url, headers = {}) =>
  new Promise((resolve) => {
    const req = http.get(url, { headers }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', () => resolve(0))
  })

const env = { ...process.env, IV_NOW_PLAYING_DATA_DIR: dataDir, IV_NOW_PLAYING_TEST: '1' }
if (!real) env.IV_NOW_PLAYING_FAKE = 'demo'
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch(exe ? { executablePath: exe, env } : { args: [root], cwd: root, env })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.waitForSelector('#skins .skin', { timeout: 60000 })
await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {})
const port = await app.evaluate(() => globalThis.ivnpTest.port())
check('server is up on 127.0.0.1', port > 0, `port ${port}`)
const trayIcon = await app.evaluate(({ app: electronApp, nativeImage }) => {
  const img = nativeImage.createFromPath(`${electronApp.getAppPath()}/build/tray.png`)
  return img.isEmpty() ? null : img.getSize()
})
check('the tray icon loads (32 x 32)', trayIcon?.width === 32 && trayIcon?.height === 32, JSON.stringify(trayIcon))

// Server boundary checks
check('widget page answers', (await get(`http://127.0.0.1:${port}/w/main`)) === 200)
check('another host name is refused', (await get(`http://127.0.0.1:${port}/w/main`, { Host: 'evil.example' })) === 403)

const url = await page.textContent('#url')
check('OBS link shown', url === `http://127.0.0.1:${port}/w/main`, url)
check('OBS size shown', /\d+ × \d+/.test(await page.textContent('#size')), await page.textContent('#size'))

const frame = () => page.frameLocator('#preview')
// Real songs need a moment to arrive; demo songs come straight away.
if (!real) {
  await page.click('label:has(#demo)')
}
await page.waitForTimeout(1500)
const title = await frame().locator('.np-title .t1').textContent()
check('preview shows a song', Boolean(title), title)

for (const skin of ['strip', 'card', 'eye', 'ticker']) {
  await page.click(`#skins .skin[data-v="${skin}"]`)
  await page.waitForTimeout(900)
  const cls = await frame().locator('#np').getAttribute('class')
  check(`skin ${skin} applies to the widget`, cls.includes(`skin-${skin}`), cls)
  await page.screenshot({ path: path.join(out, `editor-${skin}.png`) })
  await frame().locator('#np').screenshot({ path: path.join(out, `widget-${skin}.png`) })
}

// Saved to disk?
const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
check('settings saved to the data folder', saved.profiles[0].skin === 'ticker')

// Light theme, spinning record, custom colour on the card skin
await page.click('#skins .skin[data-v="card"]')
await page.click('.seg[data-key="theme"] button[data-v="light"]')
await page.click('.seg[data-key="cover"] button[data-v="spin"]')
await page.click('.seg[data-key="accent"] button[data-v="custom"]')
await page.fill('input[data-key="tint"]', '#36c5f0')
await page.check('input[data-key="showTimes"]')
await page.waitForTimeout(900)
const accent = await frame().locator('#np').evaluate((e) => e.style.getPropertyValue('--accent'))
check('custom colour reaches the widget', accent === '#36c5f0', accent)
await frame().locator('#np').screenshot({ path: path.join(out, 'widget-card-light-spin.png') })

// Hide when paused: the demo pauses every 30 s, so just check the setting shows its delay field.
await page.click('.seg[data-key="visibility"] button[data-v="pause"]')
check('pause delay field appears', await page.isVisible('#delayRow'))
await page.click('.seg[data-key="visibility"] button[data-v="always"]')

// Nothing playing message fields
await page.click('.seg[data-key="nothingPlaying"] button[data-v="show"]')
check('nothing-playing fields appear', await page.isVisible('#npFields'))

// Second widget
await page.click('#addBtn')
await page.fill('#addName', 'Just chatting')
await page.click('#addForm button')
await page.waitForTimeout(600)
const url2 = await page.textContent('#url')
check('a second widget gets its own link', url2.endsWith('/w/just-chatting'), url2)
check('second widget answers', (await get(url2)) === 200)

// Delete it (answer the confirmation for the test)
await app.evaluate(({ dialog }) => {
  dialog.showMessageBox = async () => ({ response: 0 })
})
await page.click('#delete')
await page.waitForTimeout(600)
const finalCfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
const left = finalCfg.profiles.map((p) => p.id)
check('a change made just before adding a widget stays on its own widget', finalCfg.profiles[0].nothingPlaying === 'show', finalCfg.profiles[0].nothingPlaying)
check('deleting removes only that widget', left.join(',') === 'main', left.join(','))

// Layout: no sideways scroll in the editor
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
check('editor has no sideways scroll', overflow <= 0, String(overflow))
check('no page errors', errors.length === 0, errors.join(' | '))

await page.screenshot({ path: path.join(out, 'editor-final.png') })
await page.$eval('.settings', (e) => e.scrollTo(0, e.scrollHeight / 2))
await page.screenshot({ path: path.join(out, 'editor-settings-middle.png') })
await page.$eval('.settings', (e) => e.scrollTo(0, e.scrollHeight))
await page.$eval('.main', (e) => e.scrollTo(0, e.scrollHeight))
await page.screenshot({ path: path.join(out, 'editor-settings-end.png') })
// A short title must not scroll after switching styles and showing again.
// Check on a short title (the demo cycles through two short and one long title).
for (let i = 0; i < 40; i++) {
  if (!(await frame().locator('.np-title .t1').textContent()).startsWith('A Very Long')) break
  await page.waitForTimeout(500)
}
await page.waitForTimeout(1200)
const scroll = await frame().locator('.np-title').evaluate((e) => {
  const had = e.classList.contains('marquee')
  e.classList.remove('marquee')
  const tooLong = e.querySelector('.t1').scrollWidth > e.clientWidth + 2
  if (had) e.classList.add('marquee')
  return { had, tooLong, text: e.querySelector('.t1').textContent }
})
check('the title scrolls only when it is too long', scroll.had === scroll.tooLong, JSON.stringify(scroll))
await app.close()
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
