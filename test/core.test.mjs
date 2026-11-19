import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { appInfo, allowed, pickSession, toTrack, trackChanged } from '../src/core/sessions.js'
import { cleanConfig, cleanProfile, createStore, PROFILE_DEFAULTS, slug } from '../src/core/settings.js'
import { createServer, hostAllowed, sniffImage } from '../src/core/server.js'
import { parseLines } from '../src/core/media.js'
import { accentFromPixels, fmtTime, livePosition, visible } from '../web/logic.js'

const spotify = { app: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify', title: 'Nuclear', artist: 'Mike Oldfield', album: 'Man On The Rocks', playing: false, position: 69660, duration: 303986, art: '' }
const video = { app: 'Chrome', title: 'Some web video', artist: '', album: '', playing: true, position: 1000, duration: 50000, art: '' }
const ytm = { app: 'Chrome', title: 'Song', artist: 'Band', album: 'Record', playing: true, position: 1000, duration: 200000, art: 'abcdef0123456789abcd.img' }

test('app names', () => {
  assert.deepEqual(appInfo(spotify.app), { name: 'Spotify', music: true })
  assert.deepEqual(appInfo('Chrome'), { name: 'Chrome', music: false })
  assert.equal(appInfo('Contoso.Player_abc!App').name, 'App')
  assert.equal(appInfo('C:\\Apps\\foo.exe').name, 'foo')
})

test('music mode skips web videos but keeps browser music', () => {
  assert.equal(allowed(video, 'music'), false)
  assert.equal(allowed(video, 'any'), true)
  assert.equal(allowed(ytm, 'music'), true)
  // A YouTube video names its channel as the artist but has no album: not music.
  assert.equal(allowed({ ...video, artist: 'Some Channel' }, 'music'), false)
  assert.equal(allowed(spotify, 'music', [spotify.app]), false)
  assert.equal(allowed({ ...spotify, title: '' }, 'any'), false)
})

test('a playing session beats a paused one; filtered ones never show', () => {
  assert.equal(pickSession([spotify, video], { sources: 'music' }).app, spotify.app)
  assert.equal(pickSession([spotify, video], { sources: 'any' }).app, 'Chrome')
  assert.equal(pickSession([video], { sources: 'music' }), null)
  const playingSpotify = { ...spotify, playing: true }
  // Two playing: stay on the one shown before.
  assert.equal(pickSession([ytm, playingSpotify], { previousApp: spotify.app }).app, spotify.app)
  assert.equal(pickSession([ytm, playingSpotify], { current: spotify.app }).app, spotify.app)
})

test('track shape and change detection', () => {
  const a = toTrack({ ...spotify, playing: true, art: '../evil' }, 1000)
  assert.equal(a.art, '')
  assert.equal(a.appName, 'Spotify')
  const b = { ...a, position: a.position + 1000, at: 2000 }
  assert.equal(trackChanged(a, b), false) // normal progress
  assert.equal(trackChanged(a, { ...b, position: a.position + 9000 }), true) // seek
  assert.equal(trackChanged(a, { ...b, playing: false }), true)
  assert.equal(trackChanged(a, null), true)
  assert.equal(trackChanged(null, null), false)
  assert.equal(toTrack({ ...spotify, position: 999999999 }).position, spotify.duration)
})

test('profiles are cleaned', () => {
  const p = cleanProfile({ skin: 'nope', tint: 'red', scale: 9999, npTitle: 'x\u0000y', blocked: ['a', 'a', 5], id: '../x' })
  assert.equal(p.skin, PROFILE_DEFAULTS.skin)
  assert.equal(p.tint, PROFILE_DEFAULTS.tint)
  assert.equal(p.scale, 250)
  assert.equal(p.npTitle, 'xy')
  assert.deepEqual(p.blocked, ['a'])
  assert.equal(p.id, 'main')
  assert.equal(cleanConfig({}).profiles.length, 1)
  assert.equal(cleanConfig({ profiles: [{ id: 'a' }, { id: 'a' }] }).profiles.length, 1)
  assert.equal(slug('Main Scene!'), 'main-scene')
})

test('store saves, adds, removes and survives a broken file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivnp-'))
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, '{broken')
  const s = createStore(file)
  assert.equal(s.get().profiles.length, 1)
  const added = s.addProfile('Main')
  assert.equal(added.id, 'main-2')
  assert.equal(s.saveProfile({ ...added, skin: 'eye' }).skin, 'eye')
  assert.equal(s.saveProfile({ ...added, id: 'missing' }), null)
  assert.equal(createStore(file).profile('main-2').skin, 'eye')
  assert.equal(s.removeProfile('main'), true)
  assert.equal(s.removeProfile('main-2'), false) // never remove the last one
})

test('media lines are parsed across chunks', () => {
  const got = []
  let rest = parseLines('{"a":1}\r\n{"b":', (x) => got.push(x))
  rest = parseLines(rest + '2}\nnoise\n', (x) => got.push(x))
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }])
  assert.equal(rest, '')
})

test('widget logic', () => {
  assert.equal(fmtTime(0), '0:00')
  assert.equal(fmtTime(61000), '1:01')
  assert.equal(fmtTime(3723000), '1:02:03')
  const t = { key: 'k', playing: true, position: 1000, duration: 5000 }
  assert.equal(livePosition(t, 0, 2000), 3000)
  assert.equal(livePosition(t, 0, 99999), 5000)
  assert.equal(livePosition({ ...t, playing: false }, 0, 2000), 1000)

  const p = { ...PROFILE_DEFAULTS, visibility: 'pause', hideDelay: 5 }
  let v = visible(p, { ...t, playing: false }, {}, 0)
  assert.equal(v.show, true)
  v = visible(p, { ...t, playing: false }, v.mem, 6000)
  assert.equal(v.show, false)
  v = visible(p, t, v.mem, 7000)
  assert.equal(v.show, true)

  const c = { ...PROFILE_DEFAULTS, visibility: 'change', visibleFor: 8 }
  v = visible(c, t, {}, 0)
  assert.equal(v.show, true)
  v = visible(c, t, v.mem, 9000)
  assert.equal(v.show, false)
  v = visible(c, { ...t, key: 'k2' }, v.mem, 10000)
  assert.equal(v.show, true)

  assert.equal(visible({ ...PROFILE_DEFAULTS, nothingPlaying: 'hide' }, null).show, false)
  assert.equal(visible({ ...PROFILE_DEFAULTS, nothingPlaying: 'show' }, null).show, true)
})

test('accent from cover pixels', () => {
  const red = new Uint8ClampedArray(4 * 16).fill(0).map((_, i) => [220, 30, 40, 255][i % 4])
  assert.match(accentFromPixels(red), /^#[0-9a-f]{6}$/)
  assert.equal(accentFromPixels(red), '#dc1e28')
  const darkRed = new Uint8ClampedArray(4 * 16).fill(0).map((_, i) => [100, 10, 20, 255][i % 4])
  assert.equal(accentFromPixels(darkRed), '#c81428') // dark colours are lifted to read on a dark card
  const grey = new Uint8ClampedArray(4 * 16).fill(128)
  assert.equal(accentFromPixels(grey), '#f44859')
})

test('image sniffing and host check', () => {
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'image/png')
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff])), 'image/jpeg')
  assert.equal(hostAllowed('127.0.0.1:7766', 7766), true)
  assert.equal(hostAllowed('localhost:7766', 7766), true)
  assert.equal(hostAllowed('evil.example:7766', 7766), false)
  assert.equal(hostAllowed(undefined, 7766), false)
})

function get(port, p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = ''
      res.on('data', (d) => {
        body += d
        if (res.headers['content-type']?.startsWith('text/event-stream') && body.includes('event: track')) {
          req.destroy()
          resolve({ status: res.statusCode, headers: res.headers, body })
        }
      })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)))
    req.end()
  })
}

test('server serves the widget, stream, art and refuses the rest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivnp-srv-'))
  const web = path.join(dir, 'web')
  const art = path.join(dir, 'art')
  fs.mkdirSync(web)
  fs.mkdirSync(art)
  fs.writeFileSync(path.join(web, 'widget.html'), '<p>w</p>')
  fs.writeFileSync(path.join(web, 'widget.js'), 'x')
  fs.writeFileSync(path.join(art, 'abcdef0123456789abcd.img'), Buffer.from([0xff, 0xd8, 0xff, 0x00]))
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'no')
  const subs = new Set()
  const srv = createServer({
    webDir: web,
    artDir: art,
    coverDir: art,
    getProfile: (id) => (id === 'main' ? { id: 'main' } : null),
    getTrack: (id) => ({ title: `track for ${id}` }),
    subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)),
  })
  const port = await srv.listen(0 || 47766)
  try {
    assert.equal((await get(port, '/w/main')).status, 200)
    assert.equal((await get(port, '/static/widget.js')).headers['content-type'], 'text/javascript; charset=utf-8')
    assert.equal((await get(port, '/static/../secret.txt')).status, 404)
    assert.equal((await get(port, '/static/%2e%2e/secret.txt')).status, 404)
    assert.equal((await get(port, '/art/abcdef0123456789abcd.img')).headers['content-type'], 'image/jpeg')
    assert.equal((await get(port, '/art/../../secret.txt')).status, 404)
    assert.equal((await get(port, '/w/main', { host: 'evil.example' })).status, 403)
    assert.equal((await get(port, '/w/main', {}, 'POST')).status, 405)
    const s = await get(port, '/api/stream/main')
    assert.match(s.body, /event: profile\ndata: \{"id":"main"\}/)
    assert.match(s.body, /track for main/)
    assert.equal(s.headers['access-control-allow-origin'], undefined)
  } finally {
    await srv.close()
  }
})
