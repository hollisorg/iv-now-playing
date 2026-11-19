// Runs the media reader (resources/media-reader.ps1, built-in Windows PowerShell) and hands each tick
// to onTick. Restarts it if it stops. IV_NOW_PLAYING_FAKE=demo swaps in made-up songs for tests.
import { spawn } from 'node:child_process'

export function parseLines(buffer, onLine) {
  const parts = buffer.split(/\r?\n/)
  const rest = parts.pop()
  for (const line of parts) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      onLine(JSON.parse(t))
    } catch {
      /* a half line or noise: skip it */
    }
  }
  return rest
}

export const DEMO_SONGS = [
  { title: 'Neon Rain', artist: 'Infinite Variance', album: 'What If', duration: 214000 },
  { title: 'The Sower', artist: 'Orchard Lights', album: 'Bluebird', duration: 187000 },
  { title: 'A Very Long Song Title That Keeps On Going Past The Edge', artist: 'The Long Names Collective', album: 'Overflow', duration: 252000 },
]

export function startMedia({ script, artDir, intervalMs = 1000, onTick, onStatus = () => {} }) {
  let child = null
  let stopped = false
  let restartTimer = null
  let failures = 0

  if (process.env.IV_NOW_PLAYING_FAKE === 'demo') {
    const started = Date.now()
    const timer = setInterval(() => {
      const t = Date.now() - started
      const i = Math.floor(t / 15000) % DEMO_SONGS.length
      const song = DEMO_SONGS[i]
      const playing = Math.floor(t / 5000) % 6 !== 5
      onTick({
        ok: true,
        at: Date.now(),
        current: 'Demo.Player',
        sessions: [{ app: 'SpotifyAB.SpotifyMusic_demo!Spotify', ...song, playing, position: (t % 15000) + 30000, art: '' }],
      })
    }, intervalMs)
    onStatus({ running: true, fake: true })
    return { stop: () => clearInterval(timer) }
  }

  const run = () => {
    let buf = ''
    child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, artDir, String(intervalMs)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buf = parseLines(buf + chunk, (tick) => {
        failures = 0
        onTick(tick)
      })
      if (buf.length > 1e6) buf = ''
    })
    let errText = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => (errText = (errText + d).slice(-2000)))
    child.on('error', (err) => onStatus({ running: false, error: err.message }))
    child.on('exit', (code) => {
      child = null
      if (stopped) return
      failures += 1
      onStatus({ running: false, error: errText.trim() || `The media reader stopped (code ${code}).` })
      // Back off: 1 s, 2 s, 4 s ... up to 30 s.
      restartTimer = setTimeout(run, Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5)))
    })
    onStatus({ running: true })
  }
  run()

  return {
    stop() {
      stopped = true
      clearTimeout(restartTimer)
      if (child) child.kill()
    },
  }
}
