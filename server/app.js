import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import helmet from 'helmet'
import { STATIC_TYPES, loadStatic } from './datasets.js'
import { fetchEvChargers } from './ev.js'
import * as geocoder from './geocode.js'
import { inUS, nearest } from './geo.js'
import { fetchAlerts } from './weather.js'

/** @typedef {import('express').Request} Req @typedef {import('express').Response} Res @typedef {import('express').NextFunction} Next */
/**
 * @typedef {(lat: number, lon: number, radiusM: number, signal: AbortSignal) =>
 *   Promise<{ stations: import('./datasets.js').Amenity[], total: number }>} LiveFetcher
 */

export const MAX_RESULTS = 500
export const MAX_RADIUS_M = 200_000
const LIVE_TYPES = ['ev_charger']
export const ALL_TYPES = new Set([...STATIC_TYPES, ...LIVE_TYPES])

const DEFAULT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

/**
 * Small per-IP fixed-window limiter. `hit`, `blocked` and `reject` let a caller count only some requests.
 * @param {{ windowMs: number, max: number, message?: string }} opts
 */
export function rateLimit({ windowMs, max, message = 'Too many requests, slow down.' }) {
  /** @type {Map<string, { n: number, start: number }>} */
  const hits = new Map()
  setInterval(() => {
    const now = Date.now()
    for (const [ip, h] of hits) if (now - h.start >= windowMs) hits.delete(ip)
  }, windowMs).unref()

  /** @param {Req} req */
  const hit = (req) => {
    const ip = req.ip ?? 'unknown'
    const now = Date.now()
    let h = hits.get(ip)
    if (!h || now - h.start >= windowMs) hits.set(ip, (h = { n: 0, start: now }))
    h.n++
    return h
  }
  /** @param {Req} req */
  const blocked = (req) => {
    const h = hits.get(req.ip ?? 'unknown')
    return h && Date.now() - h.start < windowMs && h.n >= max ? h : null
  }
  /** @param {Res} res @param {{ start: number }} h */
  const reject = (res, h) =>
    res
      .set('Retry-After', String(Math.max(1, Math.ceil((h.start + windowMs - Date.now()) / 1000))))
      .status(429)
      .json({ error: message })

  /** @param {Req} req @param {Res} res @param {Next} next */
  const middleware = (req, res, next) => {
    const h = hit(req)
    if (h.n > max) return reject(res, h)
    next()
  }
  return Object.assign(middleware, { hit, blocked, reject })
}

/**
 * Optional shared password for the whole app (HTTP Basic auth). Failed attempts are throttled per IP.
 * @param {string} password
 */
function basicAuth(password) {
  const expected = crypto.createHash('sha256').update(password).digest()
  const failures = rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Too many failed sign-in attempts.' })
  /** @param {Req} req @param {Res} res @param {Next} next */
  return (req, res, next) => {
    if (req.path === '/api/health') return next()
    const locked = failures.blocked(req)
    if (locked) return failures.reject(res, locked)
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ')
    if (scheme === 'Basic' && encoded) {
      const given = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':')
      if (crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), expected)) return next()
      failures.hit(req)
    }
    res.set('WWW-Authenticate', 'Basic realm="SWIVEL", charset="UTF-8"').status(401).send('Authentication required.')
  }
}

/** A finite number from a JSON number or a non-empty numeric string, else NaN. @param {unknown} v */
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)

/** @param {unknown} lat @param {unknown} lon */
function parsePoint(lat, lon) {
  const la = num(lat)
  const lo = num(lon)
  return la >= -90 && la <= 90 && lo >= -180 && lo <= 180 ? { lat: la, lon: lo } : null
}

/**
 * 'true' / 'false' / a hop count / a comma-separated list of addresses or subnets
 * @param {string | undefined} v
 * @returns {boolean | number | string}
 */
export function parseTrustProxy(v) {
  if (v === undefined || v === '') return process.env.DYNO ? 1 : false // Heroku's router sets X-Forwarded-*
  if (v === 'true') return true
  if (v === 'false') return false
  return /^\d+$/.test(v) ? Number(v) : v
}

/**
 * @param {{
 *   password?: string,
 *   trustProxy?: boolean | number | string,
 *   forceHttps?: boolean,
 *   distDir?: string | null,
 *   ev?: LiveFetcher,
 *   geocode?: Pick<typeof geocoder, 'geocode' | 'reverseGeocode'>,
 *   alerts?: typeof fetchAlerts,
 *   usage?: Pick<ReturnType<typeof import('./usage.js').createUsage>, 'record'>,
 * }} [opts]
 */
export function createApp(opts = {}) {
  const {
    password,
    trustProxy = false,
    forceHttps = false,
    distDir = DEFAULT_DIST,
    ev = fetchEvChargers,
    geocode = geocoder,
    alerts = fetchAlerts,
    usage,
  } = opts

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)

  if (forceHttps) {
    app.use((req, res, next) => {
      if (req.secure || req.path === '/api/health') return next()
      res.redirect(308, `https://${req.hostname}${req.originalUrl}`)
    })
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Leaflet and the map pins set inline style attributes
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(forceHttps ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: forceHttps ? { maxAge: 31536000, includeSubDomains: true } : false,
      crossOriginEmbedderPolicy: false, // map tiles are cross-origin images without CORP headers
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // the OSM tile policy asks for a referer
    }),
  )
  app.use(compression())
  if (password) app.use(basicAuth(password))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  app.use('/api', express.json({ limit: '4kb' }))

  // Coordinates travel in the POST body so they stay out of router and access logs
  app.post('/api/amenities', rateLimit({ windowMs: 60_000, max: 120 }), async (req, res) => {
    const body = req.body ?? {}
    const point = parsePoint(body.lat, body.lon)
    const radius = num(body.radius)
    const types = Array.isArray(body.types) ? body.types : []

    if (!point) return res.status(400).json({ error: 'Invalid lat/lon.' })
    if (!(radius > 0 && radius <= MAX_RADIUS_M)) return res.status(400).json({ error: `radius must be 1-${MAX_RADIUS_M} meters.` })
    if (!types.length || types.length > ALL_TYPES.size || types.some((/** @type {unknown} */ t) => typeof t !== 'string' || !ALL_TYPES.has(t))) {
      return res.status(400).json({ error: 'Unknown or missing types.' })
    }
    const { lat, lon } = point
    usage?.record(req, 'amenities', types)

    const controller = new AbortController()
    res.on('close', () => controller.abort())

    /** @type {Record<string, string>} */
    const errors = {}
    /** @type {Record<string, { shown: number, total: number }>} */
    const counts = {}
    const lists = await Promise.all(
      [...new Set(/** @type {string[]} */ (types))].map(async (type) => {
        try {
          if (LIVE_TYPES.includes(type)) {
            const { stations, total } = await ev(lat, lon, radius, controller.signal)
            const r = nearest(stations, lat, lon, radius, MAX_RESULTS)
            counts[type] = { shown: r.hits.length, total: Math.max(total, r.total) }
            return r.hits
          }
          const r = nearest(await loadStatic(type), lat, lon, radius, MAX_RESULTS)
          counts[type] = { shown: r.hits.length, total: r.total }
          return r.hits
        } catch (e) {
          console.error(`${type}:`, /** @type {Error} */ (e).message)
          errors[type] = 'Could not load this layer right now.'
          return []
        }
      }),
    )
    const amenities = lists
      .flat()
      .sort((x, y) => x.d - y.d)
      .map(({ a, d }) => ({ ...a, distance: Math.round(d) }))
    res.json({ amenities, counts, errors })
  })

  const geoLimit = rateLimit({ windowMs: 60_000, max: 30 })

  app.post('/api/geocode', geoLimit, async (req, res) => {
    const q = typeof req.body?.q === 'string' ? req.body.q.trim() : ''
    if (!q || q.length > 200) return res.status(400).json({ error: 'Enter a place to look up.' })
    usage?.record(req, 'geocode')
    try {
      const hit = await geocode.geocode(q)
      res.json({ hit })
    } catch (e) {
      console.error('geocode:', /** @type {Error} */ (e).message)
      res.status(502).json({ error: 'The location service is unavailable right now.' })
    }
  })

  app.post('/api/reverse', geoLimit, async (req, res) => {
    const point = parsePoint(req.body?.lat, req.body?.lon)
    if (!point) return res.status(400).json({ error: 'Invalid lat/lon.' })
    usage?.record(req, 'reverse')
    try {
      res.json({ name: await geocode.reverseGeocode(point.lat, point.lon) })
    } catch (e) {
      console.error('reverse:', /** @type {Error} */ (e).message)
      res.status(502).json({ error: 'The location service is unavailable right now.' })
    }
  })

  // NWS alerts at the search point and anywhere within `radius` meters of it (optional); outside the US there are none
  app.post('/api/alerts', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
    const point = parsePoint(req.body?.lat, req.body?.lon)
    if (!point) return res.status(400).json({ error: 'Invalid lat/lon.' })
    const radius = req.body.radius === undefined ? 0 : num(req.body.radius)
    if (!(radius >= 0 && radius <= MAX_RADIUS_M)) return res.status(400).json({ error: `radius must be 0-${MAX_RADIUS_M} meters.` })
    usage?.record(req, 'alerts')
    if (!inUS(point.lat, point.lon)) return res.json({ alerts: [] })

    const controller = new AbortController()
    res.on('close', () => controller.abort())
    try {
      res.json({ alerts: await alerts(point.lat, point.lon, radius, controller.signal) })
    } catch (e) {
      console.error('alerts:', /** @type {Error} */ (e).message)
      res.status(502).json({ error: 'The weather service is unavailable right now.' })
    }
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }))

  // Serve the built app when it exists (npm run build)
  if (distDir && fs.existsSync(distDir)) {
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, file) => {
          // Vite content-hashes everything under /assets, so those never change
          const hashed = path.relative(distDir, file).split(path.sep)[0] === 'assets'
          res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
        },
      }),
    )
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()
      // A stale tab asking for an old chunk should get a 404, not the app shell
      if (req.path.startsWith('/assets/') || path.extname(req.path)) return res.status(404).send('Not found.')
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }

  return app
}
