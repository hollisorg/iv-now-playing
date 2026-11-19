// The editor's only door into the app: a few named calls, nothing else.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ivnp', {
  config: () => ipcRenderer.invoke('config'),
  sessions: () => ipcRenderer.invoke('sessions'),
  saveProfile: (p) => ipcRenderer.invoke('save-profile', p),
  addProfile: (name, from) => ipcRenderer.invoke('add-profile', name, from),
  removeProfile: (id) => ipcRenderer.invoke('remove-profile', id),
  copy: (text) => ipcRenderer.invoke('copy', text),
  launchAtLogin: (on) => ipcRenderer.invoke('launch-at-login', on),
  pickCover: (id) => ipcRenderer.invoke('pick-cover', id),
  openHelp: () => ipcRenderer.invoke('open-help'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  // The IV Newsletter signup (src/main/newsletter.js). Same calls as the shared newsletter-preload.js; written out here
  // because this preload is CommonJS in a sandbox and can't import it.
  newsletter: {
    status: () => ipcRenderer.invoke('newsletter:status'),
    join: (input) => ipcRenderer.invoke('newsletter:join', input),
    closeCard: () => ipcRenderer.invoke('newsletter:close-card'),
    openPage: () => ipcRenderer.invoke('newsletter:open-page'),
  },
  on: (fn) => {
    const handler = (_e, msg) => fn(msg)
    ipcRenderer.on('event', handler)
    return () => ipcRenderer.removeListener('event', handler)
  },
})
