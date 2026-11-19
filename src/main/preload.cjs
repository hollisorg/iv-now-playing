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
  on: (fn) => {
    const handler = (_e, msg) => fn(msg)
    ipcRenderer.on('event', handler)
    return () => ipcRenderer.removeListener('event', handler)
  },
})
