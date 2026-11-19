// README screenshot: the packaged app on made-up songs, on its own port, in a throwaway data folder.
// Point IV_NOW_PLAYING_UPDATE_FEED at a feed whose latest.yml is this version so the bar honestly says
// "up to date".   node scripts/capture-readme.mjs <exe> <feed url> <out.png>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const [exe, feed, out] = process.argv.slice(2)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivnp-shot-'))
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ port: 7791, profiles: [{ id: 'main', name: 'Main', skin: 'card' }, { id: 'gameplay', name: 'Gameplay', skin: 'ticker' }] }))
const env = { ...process.env, IV_NOW_PLAYING_DATA_DIR: dataDir, IV_NOW_PLAYING_FAKE: 'demo', IV_NOW_PLAYING_UPDATE_FEED: feed }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: exe, env })
const page = await app.firstWindow()
await page.setViewportSize({ width: 1280, height: 800 })
await page.waitForSelector('#skins .skin')
await page.click('label:has(#demo)')
for (let i = 0; i < 40 && !(await page.textContent('#version')).includes('up to date'); i++) await page.waitForTimeout(500)
for (let i = 0; i < 40 && !(await page.frameLocator('#preview').locator('.np-title .t1').textContent()).startsWith('Neon'); i++) await page.waitForTimeout(500)
await page.waitForTimeout(1500)
await page.screenshot({ path: out })
console.log(await page.textContent('#version'))
await app.close()
