// IV Now Playing editor. Every change saves straight away; the preview is the real widget page.
import { SKIN_SIZES } from './logic.js'

const api = window.ivnp
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]

const SKIN_INFO = {
  strip: { name: 'Strip', text: 'A slim bar with the cover', art: '<svg viewBox="0 0 120 34"><rect class="b" x="1" y="5" width="118" height="24"/><rect class="a" x="5" y="9" width="16" height="16"/><rect class="c" x="26" y="11" width="56" height="5"/><rect class="b" x="26" y="19" width="38" height="4"/><rect class="a" x="1" y="27" width="70" height="2"/></svg>' },
  card: { name: 'Card', text: 'Big cover, big title', art: '<svg viewBox="0 0 120 34"><rect class="b" x="20" y="1" width="80" height="32"/><rect class="a" x="24" y="5" width="24" height="24"/><rect class="c" x="53" y="8" width="38" height="6"/><rect class="b" x="53" y="17" width="26" height="4"/><rect class="a" x="53" y="26" width="30" height="2"/></svg>' },
  eye: { name: 'Eye', text: 'The cover sits in the IV eye', art: '<svg viewBox="0 0 120 34"><rect class="b" x="1" y="3" width="118" height="28"/><path class="s" d="M6 17 C 16 5, 38 5, 48 17 C 38 29, 16 29, 6 17 Z"/><circle class="a" cx="27" cy="17" r="7"/><rect class="c" x="54" y="11" width="50" height="5"/><rect class="b" x="54" y="19" width="34" height="4"/></svg>' },
  ticker: { name: 'Ticker', text: 'A wide lower third', art: '<svg viewBox="0 0 120 34"><rect class="b" x="1" y="10" width="118" height="16"/><path class="a" d="M1 10 H34 L30 26 H1 Z"/><rect class="a" x="37" y="12" width="12" height="12"/><rect class="c" x="53" y="15" width="34" height="5"/><rect class="b" x="91" y="15" width="22" height="5"/></svg>' },
}
const ANIMS = [
  ['slide-left', 'Slide from the left'],
  ['slide-right', 'Slide from the right'],
  ['slide-up', 'Rise up'],
  ['slide-down', 'Drop down'],
  ['fade', 'Fade'],
  ['grow', 'Grow'],
  ['shrink', 'Shrink'],
  ['none', 'No animation'],
]

let config = null
let current = null // the profile being edited
let saveTimer = null
let sessions = { sessions: [], reader: {} }

function sizeFor(p) {
  const s = SKIN_SIZES[p.skin]
  return { width: Math.round((s.width * p.scale) / 100 + 20), height: Math.round((s.height * p.scale) / 100 + 20) }
}

// ---------- Preview ----------
function layoutPreview() {
  if (!current) return
  const frame = $('#preview')
  const box = $('#previewBox')
  const { width, height } = sizeFor(current)
  frame.style.width = `${width}px`
  frame.style.height = `${height}px`
  const k = Math.min(1, (box.clientWidth - 24) / width, (box.clientHeight - 24) / height)
  frame.style.transform = `translate(${Math.max(12, (box.clientWidth - width * k) / 2)}px, ${Math.max(12, (box.clientHeight - height * k) / 2)}px) scale(${k})`
}
function loadPreview() {
  if (!current) return
  const url = new URL(config.urls[current.id])
  url.searchParams.set('preview', '1')
  if ($('#demo').checked) url.searchParams.set('demo', '1')
  const frame = $('#preview')
  if (frame.dataset.src !== url.href) {
    frame.dataset.src = url.href
    frame.src = url.href
  }
  layoutPreview()
}
new ResizeObserver(layoutPreview).observe($('#previewBox'))

// ---------- Profiles ----------
function renderProfiles() {
  $('#profileList').replaceChildren(
    ...config.profiles.map((p) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = p.name
      b.setAttribute('aria-current', String(p.id === current?.id))
      b.addEventListener('click', () => select(p.id))
      return b
    }),
  )
  $('#delete').disabled = config.profiles.length <= 1
}

// A change waiting to be saved belongs to the widget it was made on: save it before switching.
async function flushSave() {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  await save()
}

async function select(id) {
  await flushSave()
  current = structuredClone(config.profiles.find((p) => p.id === id) || config.profiles[0])
  renderProfiles()
  fill()
  loadPreview()
  renderPlayers()
}

// ---------- Settings form ----------
function buildStatic() {
  $('#skins').replaceChildren(
    ...Object.entries(SKIN_INFO).map(([k, s]) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'skin'
      b.setAttribute('role', 'radio')
      b.dataset.v = k
      b.innerHTML = `${s.art}<b></b><small></small>`
      b.querySelector('b').textContent = s.name
      b.querySelector('small').textContent = s.text
      b.addEventListener('click', () => change('skin', k))
      return b
    }),
  )
  for (const sel of $$('select.anim')) {
    for (const [v, label] of ANIMS) sel.append(new Option(label, v))
  }
  for (const seg of $$('.seg[data-key]')) {
    for (const b of seg.querySelectorAll('button')) {
      b.type = 'button'
      b.addEventListener('click', () => change(seg.dataset.key, b.dataset.v))
    }
  }
  for (const input of $$('input[data-key], select[data-key]')) {
    const ev = input.type === 'range' || input.type === 'color' || input.type === 'text' || !input.type ? 'input' : 'change'
    input.addEventListener(ev, () => {
      const k = input.dataset.key
      let v = input.type === 'checkbox' ? input.checked : input.value
      if (input.hasAttribute('data-num')) v = Number(v)
      change(k, v)
    })
  }
}

function fill() {
  const p = current
  $('#name').value = p.name
  for (const b of $$('#skins .skin')) b.setAttribute('aria-checked', String(b.dataset.v === p.skin))
  for (const seg of $$('.seg[data-key]')) {
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(String(p[seg.dataset.key]) === b.dataset.v))
  }
  for (const input of $$('input[data-key], select[data-key]')) {
    if (document.activeElement === input && input.type !== 'checkbox') continue
    if (input.type === 'checkbox') input.checked = Boolean(p[input.dataset.key])
    else input.value = p[input.dataset.key]
  }
  $('#scaleOut').textContent = `${p.scale}%`
  $('#tintRow').hidden = p.accent !== 'custom'
  $('#delayRow').hidden = p.visibility !== 'pause'
  $('#forRow').hidden = p.visibility !== 'change'
  $('#npFields').hidden = p.nothingPlaying !== 'show'
  $('#clearCover').hidden = !p.npCover
  const { width, height } = sizeFor(p)
  $('#size').textContent = `${width} × ${height} px`
  $('#size2').textContent = `${width} × ${height}`
  $('#url').textContent = config.urls[p.id]
}

function change(key, value) {
  current[key] = value
  fill()
  layoutPreview()
  clearTimeout(saveTimer)
  $('#saved').textContent = 'Saving...'
  saveTimer = setTimeout(() => {
    saveTimer = null
    save()
  }, 150)
}

async function save() {
  const saved = await api.saveProfile(current)
  if (!saved) {
    $('#saved').textContent = 'Could not save. Close and reopen the window.'
    return
  }
  const i = config.profiles.findIndex((p) => p.id === saved.id)
  config.profiles[i] = saved
  // Keep what's being typed; take everything else from the saved copy (it may have been cleaned up).
  current = { ...saved, name: current.name === saved.name ? saved.name : current.name }
  renderProfiles()
  fill()
  $('#saved').textContent = 'Saved'
}

// ---------- Players on this PC ----------
function renderPlayers() {
  const list = $('#playerList')
  const r = sessions.reader || {}
  $('#readerState').textContent = r.fake ? 'Test songs' : r.running ? 'Live' : r.error ? 'Stopped' : ''
  $('#readerNote').textContent = r.fake ? 'Test mode: made-up songs.' : r.running === false && r.error ? `Can't read Windows' media controls right now: ${r.error}` : ''
  if (!current) return
  const rows = sessions.sessions || []
  if (!rows.length) {
    const li = document.createElement('li')
    li.className = 'note empty'
    li.textContent = 'Nothing is playing. Start a song in Spotify, Apple Music, TIDAL, YouTube Music or a browser.'
    list.replaceChildren(li)
    return
  }
  // One row per app, so a player with several tabs shows once.
  const seen = new Map()
  for (const s of rows) if (!seen.has(s.app) || s.playing) seen.set(s.app, s)
  list.replaceChildren(
    ...[...seen.values()].map((s) => {
      const li = document.createElement('li')
      const label = document.createElement('label')
      label.className = 'player'
      const text = document.createElement('span')
      const name = document.createElement('span')
      name.className = 'pname'
      const dot = document.createElement('span')
      dot.className = `dot${s.playing ? ' on' : ''}`
      name.append(dot, s.appName)
      const tr = document.createElement('span')
      tr.className = 'ptrack'
      tr.textContent = [s.title, s.artist].filter(Boolean).join(' · ') || 'No song details'
      text.append(name, tr)
      if (current.sources === 'music' && !s.music && !(s.artist && s.album)) {
        const why = document.createElement('span')
        why.className = 'why'
        why.textContent = 'Not shown: not a music player. Pick "Anything that plays" to show it.'
        text.append(why)
      }
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.className = 'sw'
      box.setAttribute('aria-label', `Show ${s.appName}`)
      box.checked = !current.blocked.includes(s.app)
      box.addEventListener('change', () => {
        const blocked = new Set(current.blocked)
        if (box.checked) blocked.delete(s.app)
        else blocked.add(s.app)
        change('blocked', [...blocked])
      })
      label.append(text, box)
      li.append(label)
      return li
    }),
  )
}

// ---------- Wiring ----------
$('#name').addEventListener('input', () => change('name', $('#name').value))
$('#demo').addEventListener('change', loadPreview)
$('#copy').addEventListener('click', async () => {
  if (await api.copy(config.urls[current.id])) {
    $('#copy').textContent = 'Copied'
    setTimeout(() => ($('#copy').textContent = 'Copy link'), 1600)
  }
})
$('#login').addEventListener('change', async () => {
  $('#login').checked = await api.launchAtLogin($('#login').checked)
})
const showAdd = (on) => {
  $('#addForm').hidden = !on
  $('#addBtn').hidden = on
  if (on) $('#addName').focus()
}
$('#addBtn').addEventListener('click', () => showAdd(true))
$('#addCancel').addEventListener('click', () => showAdd(false))
$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  await flushSave()
  const name = $('#addName').value.trim() || 'New widget'
  const p = await api.addProfile(name)
  if (p) {
    $('#addName').value = ''
    showAdd(false)
    config = await api.config()
    select(p.id)
  }
})
$('#duplicate').addEventListener('click', async () => {
  await flushSave()
  const p = await api.addProfile(`${current.name} copy`, current.id)
  if (p) {
    config = await api.config()
    select(p.id)
  }
})
$('#delete').addEventListener('click', async () => {
  await flushSave()
  if (await api.removeProfile(current.id)) {
    config = await api.config()
    select(config.profiles[0].id)
  }
})
$('#pickCover').addEventListener('click', async () => {
  const r = await api.pickCover(current.id)
  $('#coverError').hidden = !r?.error
  if (r?.error) $('#coverError').textContent = r.error
  else if (r) {
    current.npCover = r.npCover
    config.profiles[config.profiles.findIndex((p) => p.id === r.id)] = r
    fill()
  }
})
$('#clearCover').addEventListener('click', () => change('npCover', ''))

// ---------- Updates ----------
function renderUpdate(u) {
  if (!u) return
  const text = {
    dev: `Version ${u.version} · from source`,
    portable: `Version ${u.version} · updates only in the installed app`,
    idle: `Version ${u.version}`,
    checking: `Version ${u.version} · checking for updates`,
    current: `Version ${u.version} · up to date`,
    downloading: `Downloading ${u.available || 'update'}${u.percent ? ` · ${Math.round(u.percent)}%` : ''}`,
    ready: `Version ${u.available} is ready`,
    error: `Version ${u.version} · couldn't check for updates`,
  }[u.status]
  $('#version').textContent = text || `Version ${u.version}`
  $('#version').title = u.error || ''
  $('#restartUpdate').hidden = u.status !== 'ready'
  $('#checkUpdate').hidden = !['current', 'error', 'idle'].includes(u.status)
}
$('#restartUpdate').addEventListener('click', () => api.installUpdate())
$('#checkUpdate').addEventListener('click', async () => renderUpdate(await api.checkUpdate()))

api.on(({ type, data }) => {
  if (type === 'update') renderUpdate(data)
  else if (type === 'sessions') {
    sessions = data
    renderPlayers()
  } else if (type === 'config') {
    const keep = current?.id
    config = data
    $('#login').checked = data.launchAtLogin
    renderProfiles()
    if (keep && !data.profiles.some((p) => p.id === keep)) select(data.profiles[0].id)
  }
})

async function start() {
  config = await api.config()
  sessions = (await api.sessions()) || sessions
  $('#login').checked = config.launchAtLogin
  $('#login').disabled = config.testCopy
  renderUpdate(config.update)
  if (config.port !== config.wantedPort) {
    $('#portNote').hidden = false
    $('#portNote').textContent = `Port ${config.wantedPort} was busy, so this run uses ${config.port}. If OBS shows nothing, copy the link again.`
  }
  buildStatic()
  select(config.profiles[0].id)
}
start()
