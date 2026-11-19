// Widget logic with no DOM, so tests can run it in Node.

export function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// Where the song is now: the reported position plus the time since it was reported, while playing.
export function livePosition(track, receivedAt, now = Date.now()) {
  if (!track) return 0
  let pos = track.position + (track.playing ? Math.max(0, now - receivedAt) : 0)
  if (track.duration) pos = Math.min(pos, track.duration)
  return Math.max(0, pos)
}

// Decides whether the widget is on screen. `mem` carries what it needs between calls:
// { key, playing, pausedAt (null while playing), changedAt }. Returns { show, mem, nothing }.
export function visible(profile, track, mem = {}, now = Date.now()) {
  const next = { ...mem }
  if (!track) {
    next.key = ''
    return { show: profile.nothingPlaying === 'show', mem: next, nothing: true }
  }
  if (track.key !== mem.key) {
    next.key = track.key
    next.changedAt = now
    next.pausedAt = track.playing ? null : now
  }
  if (track.playing) next.pausedAt = null
  else if (next.pausedAt == null) next.pausedAt = now
  next.playing = track.playing

  let show = true
  if (profile.visibility === 'pause') {
    show = track.playing || now - next.pausedAt < profile.hideDelay * 1000
  } else if (profile.visibility === 'change') {
    show = now - (next.changedAt || 0) < profile.visibleFor * 1000
  }
  return { show, mem: next, nothing: false }
}

// Picks a lively accent from cover pixels (RGBA bytes): the most common bright, colourful hue.
// Falls back to IV red for grey or very dark covers.
export function accentFromPixels(data, fallback = '#f44859') {
  const buckets = new Map()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    if (sat < 0.25 || max < 0.25) continue
    let h
    if (max === min) h = 0
    else if (max === r) h = ((g - b) / (max - min)) % 6
    else if (max === g) h = (b - r) / (max - min) + 2
    else h = (r - g) / (max - min) + 4
    const hue = Math.round(((h * 60 + 360) % 360) / 15)
    const w = sat * max
    const cur = buckets.get(hue) || { w: 0, r: 0, g: 0, b: 0 }
    cur.w += w
    cur.r += data[i] * w
    cur.g += data[i + 1] * w
    cur.b += data[i + 2] * w
    buckets.set(hue, cur)
  }
  let best = null
  for (const v of buckets.values()) if (!best || v.w > best.w) best = v
  if (!best || best.w < 0.5) return fallback
  let [r, g, b] = [best.r / best.w, best.g / best.w, best.b / best.w]
  // Lift dark colours so they read on a dark card.
  const max = Math.max(r, g, b)
  if (max < 200) {
    const k = 200 / Math.max(1, max)
    ;[r, g, b] = [r * k, g * k, b * k]
  }
  const hex = (v) => Math.round(Math.min(255, v)).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export const SKIN_SIZES = {
  strip: { width: 640, height: 140 },
  card: { width: 520, height: 260 },
  eye: { width: 640, height: 200 },
  ticker: { width: 1280, height: 120 },
}
