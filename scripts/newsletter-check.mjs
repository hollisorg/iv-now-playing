// In-app check of the IV Newsletter box in IV Now Playing, against the local stand-in (no Kit).
//   node docs/newsletter/apps/stand-in.mjs 4291       (in IVAI, first)
//   node scripts/newsletter-check.mjs <outDir> [--exe "<path>.exe"]
// Uses a throwaway data folder (IV_NOW_PLAYING_DATA_DIR) and made-up songs. Nothing reaches Kit.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] || 'qa/newsletter')
const exeAt = process.argv.indexOf('--exe')
const exe = exeAt > 0 ? process.argv[exeAt + 1] : null
const STAND_IN = 'http://127.0.0.1:4291'
const tag = Date.now().toString(36)
const addr = `np-${tag}@example.com`
fs.mkdirSync(out, { recursive: true })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivnp-nl-'))
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const kit = async () => (await fetch(`${STAND_IN}/__kit`)).json()
const post = (p) => fetch(`${STAND_IN}${p}`, { method: 'POST' })
await post('/__reset')
await post('/__mode/ok')

const env = { ...process.env, IV_NOW_PLAYING_DATA_DIR: dataDir, IV_NOW_PLAYING_TEST: '1', IV_NOW_PLAYING_FAKE: 'demo', IV_NEWSLETTER_URL: `${STAND_IN}/iv-newsletter` }
delete env.ELECTRON_RUN_AS_NODE
const errors = []
async function launch() {
  const app = await electron.launch(exe ? { executablePath: exe, env } : { args: [root], cwd: root, env })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.waitForSelector('#skins .skin', { timeout: 60000 })
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {})
  return { app, page }
}
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) })

let { app, page } = await launch()
check('nothing pops up by itself', (await page.locator('dialog.ivnl-dialog').count()) === 0)
await page.click('#newsletter')
await page.waitForSelector('dialog.ivnl-dialog[open] .ivnl-input')
const input = page.locator('.ivnl-input')
check('box opens with an empty field', (await input.inputValue()) === '' && (await page.textContent('.ivnl-title')) === 'The IV Newsletter')
await shot(page, '01-open')

await page.click('.ivnl-join')
await page.waitForSelector('.ivnl-error')
check('empty address refused', (await page.textContent('.ivnl-error')).includes('valid email'), await page.textContent('.ivnl-error'))
await input.fill('not-an-address')
await page.click('.ivnl-join')
await page.waitForSelector('.ivnl-error')
check('bad address refused', (await input.getAttribute('aria-invalid')) === 'true')
await shot(page, '02-bad-address')
check('nothing sent for empty or bad addresses', (await kit()).length === 0)
await page.keyboard.type('xy')
check('typing after an error keeps the field focused, adds at the end and clears the error', (await input.inputValue()) === 'not-an-addressxy' && (await page.locator('.ivnl-error').count()) === 0 && (await input.getAttribute('aria-invalid')) === null, await input.inputValue())

await input.fill(addr)
await page.click('.ivnl-join')
await page.waitForSelector('.ivnl-done')
check('thanks shown', (await page.textContent('.ivnl-done')).includes('Check your inbox'))
await shot(page, '03-joined')
const calls = await kit()
const sub = calls.find((c) => c.referrer)
check('good address sent once to Kit (subscriber + form)', calls.length === 2 && calls.every((c) => c.email === addr), JSON.stringify(calls.map((c) => c.path)))
check('referrer tagged utm_source=iv-now-playing', /utm_source=iv-now-playing/.test(sub?.referrer || '') && /utm_medium=app/.test(sub?.referrer || ''), sub?.referrer)
const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'newsletter.json'), 'utf8'))
check('only joinedAt stored, no address', Object.keys(stored).join() === 'joinedAt,cardClosedAt' && stored.cardClosedAt === null && !JSON.stringify(stored).includes('@'), JSON.stringify(stored))
await page.keyboard.press('Escape')
check('Escape closes the dialog', (await page.locator('dialog.ivnl-dialog').count()) === 0)
await app.close()
const readable = (f) => { try { return fs.readFileSync(path.join(dataDir, f)) } catch { return null } }
const files = fs.readdirSync(dataDir, { recursive: true }).filter((f) => fs.statSync(path.join(dataDir, f)).isFile())
const others = files.filter((f) => readable(f)?.includes(addr))
check('the address is in none of the data folder files', others.length === 0, `${files.length} files; ${others.join(', ')}`)

;({ app, page } = await launch())
await page.click('#newsletter')
await page.waitForSelector('dialog.ivnl-dialog[open] .ivnl-done')
check('after a restart it says you joined', (await page.textContent('.ivnl-done')).startsWith('You joined on'), await page.textContent('.ivnl-done'))
await shot(page, '04-after-restart')

await post('/__mode/kit-down')
await page.click('.ivnl-link')
await page.locator('.ivnl-input').fill(`np2-${tag}@example.com`)
await page.click('.ivnl-join')
await page.waitForSelector('.ivnl-error')
const err = await page.textContent('.ivnl-error')
check('service down: says so and offers the website', err.includes("Couldn't reach the signup service") && err.includes('infinitevariance.ai'), err)
await shot(page, '05-service-down')
await post('/__mode/ok')
await page.click('.ivnl-dialog .ivnl-secondary')
check('Close shuts the dialog', (await page.locator('dialog.ivnl-dialog').count()) === 0)

// Smallest sensible window: the dialog still fits.
await page.setViewportSize({ width: 720, height: 560 }).catch(() => {})
await page.click('#newsletter')
await page.waitForSelector('dialog.ivnl-dialog[open]')
const box = await page.locator('dialog.ivnl-dialog').boundingBox()
check('dialog fits a 720 x 560 window', box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 720 && box.y + box.height <= 560, JSON.stringify(box))
await shot(page, '06-small-window')
await app.close()

check('no page errors', errors.length === 0, errors.join(' | '))
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ when: new Date().toISOString(), exe, results }, null, 2))
fs.rmSync(dataDir, { recursive: true, force: true })
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
