// Settings: one file in the data folder with the app options and the widget profiles. Every value that
// comes in from the editor is checked here, so a bad or old file can never break the widget.
import fs from 'node:fs'
import path from 'node:path'

export const SKINS = ['strip', 'card', 'eye', 'ticker']
export const ANIMATIONS = ['fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'grow', 'shrink', 'none']
export const FONTS = ['barlow-condensed', 'barlow', 'dm-sans', 'jetbrains-mono']
export const DEFAULT_PORT = 7766

export const PROFILE_DEFAULTS = {
  id: 'main',
  name: 'Main',
  skin: 'strip',
  theme: 'dark', // dark | light | clear
  accent: 'iv', // iv (IV red) | cover (colour from the album art) | custom
  tint: '#f44859',
  cover: 'square', // square | round | spin | none
  coverGlow: false,
  coverBlur: false,
  font: 'barlow-condensed',
  showIn: 'slide-left',
  showOut: 'fade',
  visibility: 'always', // always | pause (hide when paused) | change (show for a while on a new song)
  hideDelay: 5,
  visibleFor: 8,
  showProgress: true,
  showTimes: false,
  showAlbum: false,
  showApp: false,
  bars: true,
  nothingPlaying: 'hide', // hide | show
  npTitle: 'Nothing playing',
  npArtist: 'Music starts soon',
  npCover: '',
  sources: 'music', // music | any
  blocked: [],
  scale: 100,
  align: 'left', // left | right
}

export const APP_DEFAULTS = { port: DEFAULT_PORT, launchAtLogin: false, profiles: [{ ...PROFILE_DEFAULTS }] }

const pick = (v, list, d) => (list.includes(v) ? v : d)
const bool = (v, d) => (typeof v === 'boolean' ? v : d)
const num = (v, lo, hi, d) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d
}
const text = (v, max, d) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, max) : d)

export function slug(name) {
  return (
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'profile'
  )
}

export function cleanProfile(p = {}) {
  const d = PROFILE_DEFAULTS
  return {
    id: /^[a-z0-9-]{1,32}$/.test(p.id) ? p.id : d.id,
    name: text(p.name, 40, d.name).trim() || d.name,
    skin: pick(p.skin, SKINS, d.skin),
    theme: pick(p.theme, ['dark', 'light', 'clear'], d.theme),
    accent: pick(p.accent, ['cover', 'iv', 'custom'], d.accent),
    tint: /^#[0-9a-f]{6}$/i.test(p.tint) ? p.tint.toLowerCase() : d.tint,
    cover: pick(p.cover, ['square', 'round', 'spin', 'none'], d.cover),
    coverGlow: bool(p.coverGlow, d.coverGlow),
    coverBlur: bool(p.coverBlur, d.coverBlur),
    font: pick(p.font, FONTS, d.font),
    showIn: pick(p.showIn, ANIMATIONS, d.showIn),
    showOut: pick(p.showOut, ANIMATIONS, d.showOut),
    visibility: pick(p.visibility, ['always', 'pause', 'change'], d.visibility),
    hideDelay: num(p.hideDelay, 0, 120, d.hideDelay),
    visibleFor: num(p.visibleFor, 2, 120, d.visibleFor),
    showProgress: bool(p.showProgress, d.showProgress),
    showTimes: bool(p.showTimes, d.showTimes),
    showAlbum: bool(p.showAlbum, d.showAlbum),
    showApp: bool(p.showApp, d.showApp),
    bars: bool(p.bars, d.bars),
    nothingPlaying: pick(p.nothingPlaying, ['hide', 'show'], d.nothingPlaying),
    npTitle: text(p.npTitle, 80, d.npTitle),
    npArtist: text(p.npArtist, 80, d.npArtist),
    npCover: /^[a-f0-9]{20}\.(png|jpg|webp|gif)$/.test(p.npCover || '') ? p.npCover : '',
    sources: pick(p.sources, ['music', 'any'], d.sources),
    blocked: Array.isArray(p.blocked) ? [...new Set(p.blocked.filter((a) => typeof a === 'string' && a.length < 300))].slice(0, 50) : [],
    scale: num(p.scale, 50, 250, d.scale),
    align: pick(p.align, ['left', 'right'], d.align),
  }
}

export function cleanConfig(c = {}) {
  const seen = new Set()
  const profiles = (Array.isArray(c.profiles) ? c.profiles : [])
    .map(cleanProfile)
    .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
    .slice(0, 20)
  return {
    port: num(c.port, 1024, 65535, DEFAULT_PORT),
    launchAtLogin: bool(c.launchAtLogin, false),
    profiles: profiles.length ? profiles : [{ ...PROFILE_DEFAULTS }],
  }
}

export function uniqueId(name, profiles) {
  const base = slug(name)
  const taken = new Set(profiles.map((p) => p.id))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const id = `${base.slice(0, 28)}-${i}`
    if (!taken.has(id)) return id
  }
}

export function createStore(file) {
  let config
  try {
    config = cleanConfig(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    config = cleanConfig(APP_DEFAULTS)
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2))
    fs.renameSync(tmp, file)
  }
  return {
    get: () => config,
    profile: (id) => config.profiles.find((p) => p.id === id) || null,
    setApp(patch) {
      config = cleanConfig({ ...config, ...patch, profiles: config.profiles })
      save()
      return config
    },
    saveProfile(p) {
      const clean = cleanProfile(p)
      const i = config.profiles.findIndex((x) => x.id === clean.id)
      if (i < 0) return null
      config.profiles[i] = clean
      save()
      return clean
    },
    addProfile(name, from) {
      if (config.profiles.length >= 20) return null
      const base = from ? config.profiles.find((p) => p.id === from) : null
      const p = cleanProfile({ ...(base || PROFILE_DEFAULTS), name, id: uniqueId(name, config.profiles) })
      config.profiles.push(p)
      save()
      return p
    },
    removeProfile(id) {
      if (config.profiles.length <= 1) return false
      const before = config.profiles.length
      config.profiles = config.profiles.filter((p) => p.id !== id)
      if (config.profiles.length !== before) save()
      return config.profiles.length !== before
    },
  }
}
