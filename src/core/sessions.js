// Turns the media reader's sessions (one per app that shows in Windows' media flyout) into the one
// track the widget should show. Pure functions; no Electron, no I/O.

// App ids are Windows AppUserModelIDs such as "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" or "Chrome".
const KNOWN_APPS = [
  { re: /spotify/i, name: 'Spotify', music: true },
  { re: /applemusic|apple\.music|itunes/i, name: 'Apple Music', music: true },
  { re: /tidal/i, name: 'TIDAL', music: true },
  { re: /deezer/i, name: 'Deezer', music: true },
  { re: /amazon.*music|amazonmusic/i, name: 'Amazon Music', music: true },
  { re: /ytmdesktop|youtube-music|youtubemusic|ytmusic/i, name: 'YouTube Music', music: true },
  { re: /pear/i, name: 'Pear Desktop', music: true },
  { re: /zunemusic|microsoft\.media\.player|mediaplayer/i, name: 'Media Player', music: true },
  { re: /foobar2000/i, name: 'foobar2000', music: true },
  { re: /musicbee/i, name: 'MusicBee', music: true },
  { re: /aimp/i, name: 'AIMP', music: true },
  { re: /winamp/i, name: 'Winamp', music: true },
  { re: /soundcloud/i, name: 'SoundCloud', music: true },
  { re: /cider/i, name: 'Cider', music: true },
  { re: /vlc/i, name: 'VLC', music: false },
  { re: /chrome/i, name: 'Chrome', music: false },
  { re: /msedge|microsoftedge/i, name: 'Edge', music: false },
  { re: /firefox/i, name: 'Firefox', music: false },
  { re: /brave/i, name: 'Brave', music: false },
  { re: /opera/i, name: 'Opera', music: false },
]

export function appInfo(appId = '') {
  const hit = KNOWN_APPS.find((a) => a.re.test(appId))
  if (hit) return { name: hit.name, music: hit.music }
  // Unknown app: a readable name from the id ("Company.App_hash!App" -> "App", "foo.exe" -> "foo").
  const tail = String(appId).split('!').pop().split('\\').pop().replace(/\.exe$/i, '')
  return { name: tail || 'Unknown app', music: false }
}

export function trackKey(s) {
  return s ? `${s.app}|${s.title}|${s.artist}|${s.album}` : ''
}

// "music": music apps, plus browser tabs that name both an artist and an album (YouTube Music and
// Spotify's web player do; a YouTube video names only its channel as the artist). "any": every app
// with a title.
export function allowed(session, sources = 'music', blocked = []) {
  if (!session || !session.title) return false
  if (blocked.includes(session.app)) return false
  if (sources === 'any') return true
  return appInfo(session.app).music || Boolean(session.artist && session.album)
}

// Picks the session to show. Playing beats paused; among those, stay on the app shown last time so the
// widget doesn't jump between two players, then Windows' own "current" session, then the first one.
export function pickSession(sessions = [], { sources = 'music', blocked = [], current = '', previousApp = '' } = {}) {
  const ok = sessions.filter((s) => allowed(s, sources, blocked))
  if (!ok.length) return null
  const order = (list) =>
    list.find((s) => s.app === previousApp) || list.find((s) => s.app === current) || list[0]
  const playing = ok.filter((s) => s.playing)
  if (playing.length) return order(playing)
  return order(ok)
}

export function toTrack(session, at = Date.now()) {
  if (!session) return null
  const info = appInfo(session.app)
  const duration = Math.max(0, Number(session.duration) || 0)
  let position = Math.max(0, Number(session.position) || 0)
  if (duration) position = Math.min(position, duration)
  return {
    key: trackKey(session),
    title: String(session.title || ''),
    artist: String(session.artist || ''),
    album: String(session.album || ''),
    app: String(session.app || ''),
    appName: info.name,
    playing: Boolean(session.playing),
    position,
    duration,
    art: /^[a-f0-9]{20}\.img$/.test(session.art || '') ? session.art : '',
    at,
  }
}

// Has the shown track changed enough to tell the widgets? Position drifts every tick, so only a jump
// (seek) of more than 1.5 s counts.
export function trackChanged(a, b) {
  if (!a || !b) return a !== b
  if (a.key !== b.key || a.playing !== b.playing || a.art !== b.art || a.duration !== b.duration) return true
  const expected = a.playing ? a.position + (b.at - a.at) : a.position
  return Math.abs(b.position - expected) > 1500
}
