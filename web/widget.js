// IV Now Playing widget: listens to the app's local stream and draws the chosen skin.
// ?preview=1 (the editor's preview) explains when it is hidden; ?demo=1 plays made-up songs.
import { accentFromPixels, fmtTime, livePosition, visible } from './logic.js'

const params = new URLSearchParams(location.search)
const preview = params.get('preview') === '1'
const demo = params.get('demo') === '1'
const id = (location.pathname.match(/^\/w\/([a-z0-9-]{1,32})$/) || [])[1] || 'main'

const el = {
  stage: document.getElementById('stage'),
  np: document.getElementById('np'),
  ghost: document.getElementById('ghost'),
  bg: document.querySelector('.np-bg'),
  img: document.querySelector('.np-art img'),
  app: document.querySelector('.np-app'),
  title: document.querySelector('.np-title'),
  artist: document.querySelector('.np-artist'),
  album: document.querySelector('.np-album'),
  bar: document.querySelector('.np-progress i'),
  cur: document.querySelector('.np-cur'),
  dur: document.querySelector('.np-dur'),
}

let profile = null
let track = null
let receivedAt = Date.now()
let mem = {}
let shown = false
let leaving = false
let artUrl = ''
let accentFromArt = ''
let lastKey = null
let profileGone = false

const DEMO = [
  { title: 'Neon Rain', artist: 'Infinite Variance', album: 'What If', duration: 214000 },
  { title: 'The Sower', artist: 'Orchard Lights', album: 'Bluebird', duration: 187000 },
  { title: 'A Very Long Song Title That Keeps On Going Past The Edge', artist: 'The Long Names Collective', album: 'Overflow', duration: 252000 },
]
function demoTrack() {
  const t = Date.now()
  const i = Math.floor(t / 12000) % DEMO.length
  const s = DEMO[i]
  return { key: `demo|${i}`, ...s, app: 'demo', appName: 'Spotify', playing: true, position: 40000 + (t % 12000), art: '', demo: true, at: t }
}

function setLines(box, text) {
  box.querySelector('.t1').textContent = text
  box.querySelector('.t2').textContent = text
  box.classList.remove('marquee')
  box.title = text
}
// Long titles scroll instead of being cut off.
function fitLines() {
  for (const box of [el.title, el.artist]) {
    box.classList.remove('marquee')
    // Hidden boxes measure 0 wide; they are measured again when the widget shows.
    if (!box.clientWidth) continue
    const span = box.querySelector('.t1')
    if (span.scrollWidth > box.clientWidth + 2) {
      box.style.setProperty('--dur', `${Math.max(8, span.scrollWidth / 45)}s`)
      box.classList.add('marquee')
    }
  }
}

const refit = () => setTimeout(() => requestAnimationFrame(fitLines), 700)

function coverSource(t) {
  if (t?.demo) return '/static/demo-cover.svg'
  if (t?.art) return `/art/${t.art}`
  if (!t && profile?.npCover) return `/covers/${profile.npCover}`
  return '/static/no-cover.svg'
}

function readAccent(src) {
  const img = new Image()
  img.onload = () => {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 24
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, 24, 24)
      accentFromArt = accentFromPixels(ctx.getImageData(0, 0, 24, 24).data)
    } catch {
      accentFromArt = ''
    }
    applyAccent()
  }
  img.src = src
}

function applyAccent() {
  if (!profile) return
  let a = '#f44859'
  if (profile.accent === 'custom') a = profile.tint
  else if (profile.accent === 'cover' && accentFromArt) a = accentFromArt
  el.np.style.setProperty('--accent', a)
}

function applyProfile() {
  const p = profile
  const cls = [
    'np',
    `skin-${p.skin}`,
    `theme-${p.theme}`,
    `font-${p.font}`,
    `cover-${p.cover}`,
    p.coverGlow && 'glow',
    p.coverBlur && 'blur',
    p.showProgress && 'show-progress',
    p.showTimes && 'show-times',
    p.showAlbum && 'show-album',
    p.bars && 'bars',
  ]
  // Keep the running state classes.
  for (const k of ['playing', 'swap']) if (el.np.classList.contains(k)) cls.push(k)
  for (const k of el.np.classList) if (/^(in|out)-/.test(k)) cls.push(k)
  el.np.className = cls.filter(Boolean).join(' ')
  el.np.style.setProperty('--scale', String(p.scale / 100))
  el.stage.className = p.align === 'right' ? 'right' : ''
  applyAccent()
  renderTrack(true)
}

function renderTrack(force = false) {
  if (!profile) return
  const t = track
  const key = t ? t.key : 'nothing'
  if (key !== lastKey || force) {
    const changed = lastKey !== null && key !== lastKey
    lastKey = key
    setLines(el.title, t ? t.title : profile.npTitle)
    setLines(el.artist, t ? t.artist || t.appName : profile.npArtist)
    el.album.textContent = t?.album || ''
    const src = coverSource(t)
    if (src !== artUrl) {
      artUrl = src
      el.img.src = src
      el.bg.style.backgroundImage = `url("${src}")`
      accentFromArt = ''
      if (profile.accent === 'cover') readAccent(src)
      applyAccent()
    }
    if (changed && shown) {
      el.np.classList.remove('swap')
      void el.np.offsetWidth
      el.np.classList.add('swap')
    }
    requestAnimationFrame(fitLines)
    refit()
  }
  // The small line above the title: the player's name and the playing bars, when turned on.
  el.app.textContent = profile.showApp && t ? t.appName : ''
  const kicker = t && (profile.showApp || (profile.bars && profile.skin !== 'ticker'))
  el.app.parentElement.style.display = kicker ? '' : 'none'
  el.np.classList.toggle('playing', Boolean(t?.playing))
  tick()
}

function tick() {
  if (!profile) return
  const t = track
  if (t) {
    const pos = livePosition(t, receivedAt)
    el.bar.style.width = t.duration ? `${(pos / t.duration) * 100}%` : '0%'
    el.cur.textContent = fmtTime(pos)
    el.dur.textContent = t.duration ? fmtTime(t.duration) : ''
  } else {
    el.bar.style.width = '0%'
    el.cur.textContent = ''
    el.dur.textContent = ''
  }
  const v = visible(profile, t, mem)
  mem = v.mem
  setShown(v.show, v.nothing)
}

function setShown(show, nothing) {
  if (preview) {
    el.ghost.hidden = show
    if (!show) {
      el.ghost.textContent = profileGone
        ? 'This widget was deleted.'
        : nothing
          ? 'Hidden: nothing is playing (or the player is not in your sources).'
          : profile.visibility === 'pause'
            ? 'Hidden: the song is paused.'
            : 'Hidden until the next song starts.'
    }
  }
  if (show === shown) return
  shown = show
  const p = profile
  for (const k of [...el.np.classList]) if (/^(in|out)-/.test(k)) el.np.classList.remove(k)
  if (show) {
    leaving = false
    el.np.hidden = false
    if (p.showIn !== 'none') el.np.classList.add(`in-${p.showIn}`)
    requestAnimationFrame(fitLines)
    refit()
  } else if (p.showOut === 'none') {
    el.np.hidden = true
  } else {
    leaving = true
    el.np.classList.add(`out-${p.showOut}`)
  }
}
el.np.addEventListener('animationend', (e) => {
  if (e.target === el.np && leaving) {
    leaving = false
    el.np.hidden = true
    for (const k of [...el.np.classList]) if (/^out-/.test(k)) el.np.classList.remove(k)
  }
})

function connect() {
  const es = new EventSource(`/api/stream/${id}`)
  es.addEventListener('profile', (e) => {
    const p = JSON.parse(e.data)
    profileGone = !p
    if (!p) {
      if (profile) profile = { ...profile, nothingPlaying: 'hide' }
      track = null
      tick()
      return
    }
    profile = p
    applyProfile()
  })
  es.addEventListener('track', (e) => {
    if (demo) return
    track = JSON.parse(e.data)
    receivedAt = Date.now()
    renderTrack()
  })
  // EventSource reconnects by itself when the app restarts.
}

connect()
setInterval(() => {
  if (demo) {
    const d = demoTrack()
    if (!track || track.key !== d.key) {
      track = d
      receivedAt = Date.now()
      renderTrack()
      return
    }
    track = d
    receivedAt = Date.now()
  }
  tick()
}, 250)
window.addEventListener('resize', () => requestAnimationFrame(fitLines))
// Fonts load on first use; measure again once they have, or a title can look too long in the fallback font.
document.fonts?.ready.then(() => requestAnimationFrame(fitLines))
document.fonts?.addEventListener('loadingdone', () => requestAnimationFrame(fitLines))

