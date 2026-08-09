// Minimal dependency-free server: proxies the University of Wyoming upper-air
// archive (which sends no CORS headers) and serves the built SPA in production.
import http from 'node:http'
import https from 'node:https'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT ?? 8642
const DIST = fileURLToPath(new URL('../dist', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

// In-memory cache. Completed soundings are immutable; station lists for past
// cycles are effectively immutable too. Recent cycles get a short TTL since
// late-arriving reports keep trickling in for a few hours.
const cache = new Map()
const MAX_CACHE = 400

function cacheTTL(datetimeParam) {
  if (!datetimeParam) return 5 * 60 * 1000
  const t = Date.parse(datetimeParam.replace(' ', 'T') + 'Z')
  if (Number.isNaN(t)) return 5 * 60 * 1000
  const ageH = (Date.now() - t) / 3.6e6
  return ageH > 12 ? 7 * 24 * 3.6e6 : 10 * 60 * 1000
}

function fetchUpstream(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'skew-t-viewer (personal project)' } }, (res) => {
        if (res.statusCode >= 300) {
          res.resume()
          reject(new Error(`upstream ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

/** In-flight upstream fetches, so concurrent requests for the same URL share
 *  one round-trip. */
const inflight = new Map()

function fetchAndCache(upstream, type, datetimeParam) {
  let p = inflight.get(upstream)
  if (!p) {
    p = fetchUpstream(upstream)
      .then((body) => {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value)
        cache.set(upstream, { body, type, expires: Date.now() + cacheTTL(datetimeParam) })
        return body
      })
      .finally(() => inflight.delete(upstream))
    inflight.set(upstream, p)
  }
  return p
}

async function handleWyoming(req, res, url) {
  // /api/wyo/sounding?...  →  https://weather.uwyo.edu/wsgi/sounding?...
  // /api/wyo/stations?...  →  https://weather.uwyo.edu/wsgi/sounding_json?...
  const path = url.pathname === '/api/wyo/stations' ? 'sounding_json' : 'sounding'
  const upstream = `https://weather.uwyo.edu/wsgi/${path}?${url.searchParams.toString()}`
  const type = path === 'sounding_json' ? 'application/json' : 'text/plain; charset=utf-8'
  const datetimeParam = url.searchParams.get('datetime')

  const hit = cache.get(upstream)
  if (hit) {
    if (hit.expires <= Date.now()) {
      // stale-while-revalidate: answer immediately, refresh in background
      fetchAndCache(upstream, type, datetimeParam).catch(() => {})
    }
    res.writeHead(200, { 'Content-Type': hit.type, 'X-Cache': hit.expires > Date.now() ? 'hit' : 'stale' })
    res.end(hit.body)
    return
  }
  try {
    const body = await fetchAndCache(upstream, type, datetimeParam)
    res.writeHead(200, { 'Content-Type': type, 'X-Cache': 'miss' })
    res.end(body)
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err.message ?? err) }))
  }
}

/** Cold-start mitigation: the Fly machine auto-stops when idle, wiping the
 *  in-memory cache — so warm the station lists for the two most recent
 *  cycles the moment the process boots, while the browser is still loading
 *  the page shell. */
function warmCache() {
  const now = new Date()
  now.setUTCMinutes(0, 0, 0)
  now.setUTCHours(now.getUTCHours() >= 12 ? 12 : 0)
  if (Date.now() - now.getTime() < 75 * 60 * 1000) now.setUTCHours(now.getUTCHours() - 12)
  const p = (n) => String(n).padStart(2, '0')
  for (let i = 0; i < 2; i++) {
    const d = new Date(now.getTime() - i * 12 * 3.6e6)
    const dt = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:00:00`
    // serialize exactly like handleWyoming does, so the cache key matches
    const sp = new URLSearchParams({ datetime: dt })
    const upstream = `https://weather.uwyo.edu/wsgi/sounding_json?${sp.toString()}`
    fetchAndCache(upstream, 'application/json', dt).catch(() => {})
  }
}

async function serveStatic(req, res, url) {
  let path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
  if (path === '/' || path === '\\') path = '/index.html'
  let file = join(DIST, path)
  try {
    const s = await stat(file)
    if (s.isDirectory()) file = join(file, 'index.html')
  } catch {
    file = join(DIST, 'index.html') // SPA fallback
  }
  try {
    const body = await readFile(file)
    // Vite content-hashes everything under /assets, so those are immutable;
    // the HTML shell must always be revalidated or clients keep old bundles.
    const cache = file.includes('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': cache,
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname.startsWith('/api/wyo/')) return handleWyoming(req, res, url)
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end('{"status":"ok"}')
    }
    return serveStatic(req, res, url)
  })
  .listen(PORT, () => {
    console.log(`skew-t server on :${PORT}`)
    warmCache()
  })
