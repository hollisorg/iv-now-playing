// The local web server OBS reads the widget from. Read only: GET and HEAD, on 127.0.0.1 only.
// Requests must name this machine as the host (blocks DNS-rebinding pages), and nothing sends CORS
// headers, so other websites can't read the now-playing data. Settings change only through the app.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

// Cover files from Windows have no extension, so look at the first bytes.
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) return 'image/png'
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.length > 11 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.length > 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  if (buf.length > 4 && buf.toString('ascii', 0, 4) === '<svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

export function hostAllowed(host, port) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

export function createServer({ webDir, artDir, coverDir, getProfile, getTrack, subscribe }) {
  let port = 0
  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, ...SECURITY, ...extra })
    res.end(body)
  }
  const sendFile = (req, res, file, type, cache = 'no-cache') => {
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'text/plain', 'Not found')
      send(res, 200, type || sniffImage(buf), req.method === 'HEAD' ? undefined : buf, { 'Cache-Control': cache })
    })
  }

  const server = http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host, port)) return send(res, 403, 'text/plain', 'Forbidden')
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Method not allowed', { Allow: 'GET, HEAD' })
    let url
    try {
      url = new URL(req.url, `http://127.0.0.1:${port}`)
    } catch {
      return send(res, 400, 'text/plain', 'Bad request')
    }
    const p = url.pathname

    if (p === '/') return send(res, 302, 'text/plain', '', { Location: '/w/main' })

    // The widget page, one URL per profile.
    let m = p.match(/^\/w\/([a-z0-9-]{1,32})$/)
    if (m) {
      return sendFile(req, res, path.join(webDir, 'widget.html'), TYPES['.html'])
    }

    // Live updates for a widget: the profile's settings and the track, as server-sent events.
    m = p.match(/^\/api\/stream\/([a-z0-9-]{1,32})$/)
    if (m) {
      const id = m[1]
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...SECURITY })
      const write = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
      write('profile', getProfile(id))
      write('track', getTrack(id))
      // Each widget hears only about its own profile and the track picked for it.
      const off = subscribe((type, data) => {
        if (type === 'profile' && data?.id === id) write('profile', data)
        else if (type === 'profile-removed' && data === id) write('profile', null)
        else if (type === 'track' && data?.profile === id) write('track', data.track)
      })
      const ping = setInterval(() => res.write(': ping\n\n'), 20000)
      req.on('close', () => {
        clearInterval(ping)
        off()
      })
      return
    }

    m = p.match(/^\/art\/([a-f0-9]{20}\.img)$/)
    if (m) return sendFile(req, res, path.join(artDir, m[1]), null, 'max-age=86400')

    m = p.match(/^\/covers\/([a-f0-9]{20}\.(png|jpg|webp|gif))$/)
    if (m) return sendFile(req, res, path.join(coverDir, m[1]), null, 'max-age=86400')

    m = p.match(/^\/static\/([a-z0-9._-]+(?:\/[a-z0-9._-]+)?)$/i)
    if (m && !m[1].includes('..')) {
      const file = path.join(webDir, m[1])
      if (!file.startsWith(webDir + path.sep)) return send(res, 404, 'text/plain', 'Not found')
      return sendFile(req, res, file, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream')
    }

    send(res, 404, 'text/plain', 'Not found')
  })

  // Tries the saved port first and then the next ten, so a busy port doesn't stop the app.
  const listen = (wanted) =>
    new Promise((resolve, reject) => {
      let tryPort = wanted
      const attempt = () => {
        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE' && tryPort < wanted + 10) {
            tryPort += 1
            attempt()
          } else reject(err)
        })
        server.listen(tryPort, '127.0.0.1', () => {
          port = server.address().port
          resolve(port)
        })
      }
      attempt()
    })

  return { listen, close: () => new Promise((r) => server.close(() => r())), port: () => port, server }
}
