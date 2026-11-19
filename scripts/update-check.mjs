// Update check: starts the packaged app against a local test feed (IV_NOW_PLAYING_UPDATE_FEED) in a
// throwaway data folder and waits until the editor says the newer version is ready. A test-feed copy
// downloads but never installs.
//   node scripts/update-check.mjs <exe> <feed url> <expected version>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const [exe, feed, expected] = process.argv.slice(2)
const env = {
  ...process.env,
  IV_NOW_PLAYING_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ivnp-upd-')),
  IV_NOW_PLAYING_FAKE: 'demo',
  IV_NOW_PLAYING_UPDATE_FEED: feed,
  IV_NOW_PLAYING_TEST: '1',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: exe, env })
const page = await app.firstWindow()
await page.waitForSelector('#version')
const seen = new Set()
let ok = false
for (let i = 0; i < 120; i++) {
  const text = (await page.textContent('#version')).trim()
  if (!seen.has(text)) {
    seen.add(text)
    console.log(`state: ${text}`)
  }
  if (text === `Version ${expected} is ready` && (await page.isVisible('#restartUpdate'))) {
    ok = true
    break
  }
  await page.waitForTimeout(1000)
}
const menu = await app.evaluate(() => globalThis.ivnpTest?.trayLabels?.() ?? null)
if (menu) console.log(`tray menu: ${menu.join(' | ')}`)
await app.close()
console.log(ok ? 'PASS  update downloaded and Restart to update shown' : 'FAIL  no ready update')
process.exit(ok ? 0 : 1)
