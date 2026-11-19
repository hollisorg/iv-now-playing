// IV Now Playing main process: one instance, a tray icon, the media reader, the local widget server
// and the editor window. The editor is the only thing that can change settings (through IPC).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { pickSession, toTrack, trackChanged, appInfo } from '../core/sessions.js'
import { createStore } from '../core/settings.js'
import { createServer } from '../core/server.js'
import { startMedia } from '../core/media.js'

const APP_ID = 'ai.infinitevariance.nowplaying'
const PRODUCT = 'IV Now Playing'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const webDir = path.join(root, 'web')
const resources = app.isPackaged ? process.resourcesPath : path.join(root, 'resources')
const iconPath = path.join(root, 'build', 'icon.png')
const trayPath = path.join(root, 'build', 'tray.png')

// A test copy pointed at a throwaway data folder must not touch Windows' startup list.
const borrowedDataDir = Boolean(process.env.IV_NOW_PLAYING_DATA_DIR?.trim())
const dataDir = borrowedDataDir ? path.resolve(process.env.IV_NOW_PLAYING_DATA_DIR) : path.join(app.getPath('appData'), PRODUCT)
fs.mkdirSync(dataDir, { recursive: true })
app.setPath('userData', dataDir)
app.setAppUserModelId(APP_ID)

const artDir = path.join(app.getPath('temp'), 'iv-now-playing-art')
const coverDir = path.join(dataDir, 'covers')
fs.mkdirSync(artDir, { recursive: true })
fs.mkdirSync(coverDir, { recursive: true })

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const store = createStore(path.join(dataDir, 'settings.json'))
  const listeners = new Set()
  const broadcast = (type, data) => {
    for (const fn of listeners) fn(type, data)
    if (editor && !editor.isDestroyed()) editor.webContents.send('event', { type, data })
  }

  let tray = null
  let editor = null
  let server = null
  let media = null
  let port = 0
  let lastTick = { sessions: [], current: '' }
  let readerStatus = { running: false }
  const shownByProfile = new Map() // profile id -> track (each profile has its own source rules)
  const hidden = process.argv.includes('--hidden')

  // Each profile can filter sources differently, so the track is picked per profile.
  function trackFor(profileId) {
    return shownByProfile.get(profileId) ?? null
  }
  function onTick(tick) {
    lastTick = tick
    if (!tick.ok) return
    for (const p of store.get().profiles) {
      const prev = shownByProfile.get(p.id)
      const s = pickSession(tick.sessions || [], { sources: p.sources, blocked: p.blocked, current: tick.current, previousApp: prev?.app })
      const next = toTrack(s, tick.at || Date.now())
      if (trackChanged(prev ?? null, next)) {
        shownByProfile.set(p.id, next)
        broadcast('track', { profile: p.id, track: next })
      } else if (next && prev) {
        // Keep the stored position fresh without telling anyone.
        shownByProfile.set(p.id, { ...prev, position: next.position, at: next.at })
      }
    }
    if (editor && !editor.isDestroyed()) {
      editor.webContents.send('event', { type: 'sessions', data: sessionsSummary() })
    }
  }
  function sessionsSummary() {
    return {
      reader: readerStatus,
      sessions: (lastTick.sessions || []).map((s) => ({ app: s.app, appName: appInfo(s.app).name, music: appInfo(s.app).music, title: s.title, artist: s.artist, album: s.album, playing: s.playing })),
    }
  }

  function widgetUrl(id) {
    return `http://127.0.0.1:${port}/w/${id}`
  }

  function openEditor() {
    if (editor && !editor.isDestroyed()) {
      if (editor.isMinimized()) editor.restore()
      editor.show()
      editor.focus()
      return
    }
    editor = new BrowserWindow({
      width: 1240,
      height: 860,
      minWidth: 960,
      minHeight: 640,
      title: PRODUCT,
      icon: iconPath,
      backgroundColor: '#0e0b0d',
      autoHideMenuBar: true,
      show: false,
      webPreferences: { preload: path.join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    editor.removeMenu()
    editor.loadURL(`http://127.0.0.1:${port}/static/editor.html`)
    editor.once('ready-to-show', () => {
      if (!(hidden && process.env.IV_NOW_PLAYING_OPEN_ON_START !== '1')) editor.show()
    })
    // Links in the editor open in the normal browser.
    editor.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    editor.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(`http://127.0.0.1:${port}/`)) e.preventDefault()
    })
    editor.on('closed', () => (editor = null))
  }

  const fromEditor = (event) => editor && event.sender === editor.webContents

  function updateTray() {
    if (!tray) return
    const cfg = store.get()
    const menu = Menu.buildFromTemplate([
      { label: 'Open IV Now Playing', click: openEditor },
      { type: 'separator' },
      ...cfg.profiles.map((p) => ({ label: `Copy OBS link: ${p.name}`, click: () => clipboard.writeText(widgetUrl(p.id)) })),
      { type: 'separator' },
      {
        label: 'Open at login',
        type: 'checkbox',
        checked: cfg.launchAtLogin,
        enabled: !borrowedDataDir,
        click: (item) => setLaunchAtLogin(item.checked),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
    tray.setContextMenu(menu)
    const t = trackFor(cfg.profiles[0].id)
    tray.setToolTip(t ? `${PRODUCT}\n${t.title}${t.artist ? `\n${t.artist}` : ''}`.slice(0, 127) : `${PRODUCT}\nNothing playing`)
  }

  function setLaunchAtLogin(on) {
    store.setApp({ launchAtLogin: Boolean(on) })
    if (!borrowedDataDir) app.setLoginItemSettings({ openAtLogin: Boolean(on), args: ['--hidden'] })
    updateTray()
    broadcast('config', configForEditor())
  }

  function configForEditor() {
    const cfg = store.get()
    return { ...cfg, port, wantedPort: cfg.port, urls: Object.fromEntries(cfg.profiles.map((p) => [p.id, widgetUrl(p.id)])), testCopy: borrowedDataDir }
  }

  // ---------- Editor IPC (only from the editor window) ----------
  ipcMain.handle('config', (e) => (fromEditor(e) ? configForEditor() : null))
  ipcMain.handle('sessions', (e) => (fromEditor(e) ? sessionsSummary() : null))
  ipcMain.handle('save-profile', (e, p) => {
    if (!fromEditor(e)) return null
    const saved = store.saveProfile(p)
    if (saved) {
      broadcast('profile', saved)
      // Source rules may have changed: pick again from the last reading.
      shownByProfile.delete(saved.id)
      onTick(lastTick)
      if (!shownByProfile.get(saved.id)) broadcast('track', { profile: saved.id, track: null })
      updateTray()
    }
    return saved
  })
  ipcMain.handle('add-profile', (e, name, from) => {
    if (!fromEditor(e)) return null
    const p = store.addProfile(String(name || 'New widget'), from)
    if (p) {
      onTick(lastTick)
      updateTray()
      broadcast('config', configForEditor())
    }
    return p
  })
  ipcMain.handle('remove-profile', async (e, id) => {
    if (!fromEditor(e)) return false
    const p = store.profile(id)
    if (!p) return false
    const r = await dialog.showMessageBox(editor, {
      type: 'warning',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Delete widget',
      message: `Delete "${p.name}"?`,
      detail: 'Its OBS link will stop working. This cannot be undone.',
    })
    if (r.response !== 0) return false
    const ok = store.removeProfile(id)
    if (ok) {
      shownByProfile.delete(id)
      broadcast('profile-removed', id)
      updateTray()
      broadcast('config', configForEditor())
    }
    return ok
  })
  ipcMain.handle('copy', (e, text) => {
    if (!fromEditor(e)) return false
    if (typeof text !== 'string' || !text.startsWith(`http://127.0.0.1:${port}/`)) return false
    clipboard.writeText(text)
    return true
  })
  ipcMain.handle('launch-at-login', (e, on) => {
    if (!fromEditor(e)) return null
    setLaunchAtLogin(on)
    return store.get().launchAtLogin
  })
  ipcMain.handle('pick-cover', async (e, profileId) => {
    if (!fromEditor(e)) return null
    const r = await dialog.showOpenDialog(editor, {
      title: 'Choose a picture for "nothing playing"',
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    })
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    const st = fs.statSync(file)
    if (st.size > 5 * 1024 * 1024) return { error: 'That picture is over 5 MB. Choose a smaller one.' }
    const buf = fs.readFileSync(file)
    const ext = { '.jpeg': 'jpg', '.jpg': 'jpg', '.png': 'png', '.webp': 'webp', '.gif': 'gif' }[path.extname(file).toLowerCase()]
    if (!ext) return { error: 'Choose a PNG, JPG, WebP or GIF picture.' }
    const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20)}.${ext}`
    fs.writeFileSync(path.join(coverDir, name), buf)
    const p = store.profile(profileId)
    if (!p) return null
    const saved = store.saveProfile({ ...p, npCover: name })
    broadcast('profile', saved)
    return saved
  })
  ipcMain.handle('open-help', (e) => {
    if (!fromEditor(e)) return
    shell.openExternal('https://infinitevariance.ai/downloads')
  })

  app.on('second-instance', openEditor)
  app.on('window-all-closed', () => {
    /* stay in the tray */
  })

  app.whenReady().then(async () => {
    server = createServer({
      webDir,
      artDir,
      coverDir,
      getProfile: (id) => store.profile(id),
      getTrack: (id) => trackFor(id),
      subscribe: (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    })
    port = await server.listen(store.get().port)

    tray = new Tray(nativeImage.createFromPath(trayPath))
    tray.on('click', openEditor)
    updateTray()

    media = startMedia({
      script: path.join(resources, 'media-reader.ps1'),
      artDir,
      intervalMs: 1000,
      onTick: (t) => {
        onTick(t)
        updateTray()
      },
      onStatus: (s) => {
        readerStatus = s
        if (editor && !editor.isDestroyed()) editor.webContents.send('event', { type: 'sessions', data: sessionsSummary() })
      },
    })

    if (!borrowedDataDir) app.setLoginItemSettings({ openAtLogin: store.get().launchAtLogin, args: ['--hidden'] })
    if (!hidden || process.env.IV_NOW_PLAYING_OPEN_ON_START === '1') openEditor()
  })

  app.on('before-quit', () => {
    media?.stop()
    server?.close()
  })

  // Read-only hooks for scripts/ui-check.mjs.
  if (process.env.IV_NOW_PLAYING_TEST === '1') {
    globalThis.ivnpTest = { port: () => port, editorVisible: () => Boolean(editor?.isVisible()) }
  }
}
