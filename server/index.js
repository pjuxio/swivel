import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { STATIC_TYPES, loadStatic } from './datasets.js'
import { fetchEvChargers } from './ev.js'

const PORT = Number(process.env.PORT) || 3001
const MAX_RESULTS = 300
const MAX_RADIUS_M = 200_000
const LIVE_TYPES = ['ev_charger']
const ALL_TYPES = new Set([...STATIC_TYPES, ...LIVE_TYPES])

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

function distanceMeters(aLat, aLon, bLat, bLon) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

// Items within radiusM of the point, nearest first, each tagged with its distance
function nearest(items, lat, lon, radiusM) {
  const dLat = radiusM / 111_000 // cheap bounding box before the exact distance
  const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  const out = []
  for (const a of items) {
    if (Math.abs(a.lat - lat) > dLat || Math.abs(a.lon - lon) > dLon) continue
    const d = distanceMeters(lat, lon, a.lat, a.lon)
    if (d <= radiusM) out.push({ a, d })
  }
  return out.sort((x, y) => x.d - y.d).slice(0, MAX_RESULTS)
}

// Small per-IP limiter so the API (and the NLR key behind it) can't be hammered
function rateLimit({ windowMs, max }) {
  const hits = new Map()
  setInterval(() => hits.clear(), windowMs).unref()
  return (req, res, next) => {
    const n = (hits.get(req.ip) ?? 0) + 1
    hits.set(req.ip, n)
    if (n > max) return res.status(429).json({ error: 'Too many requests, slow down.' })
    next()
  }
}

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/amenities', rateLimit({ windowMs: 60_000, max: 120 }), async (req, res) => {
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)
  const radius = Number(req.query.radius)
  const types = String(req.query.types ?? '').split(',').filter(Boolean)

  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) return res.status(400).json({ error: 'Invalid lat/lon.' })
  if (!(radius > 0 && radius <= MAX_RADIUS_M)) return res.status(400).json({ error: `radius must be 1-${MAX_RADIUS_M} meters.` })
  if (!types.length || types.length > ALL_TYPES.size || types.some((t) => !ALL_TYPES.has(t))) {
    return res.status(400).json({ error: 'Unknown or missing types.' })
  }

  const controller = new AbortController()
  res.on('close', () => controller.abort())

  const errors = {}
  const lists = await Promise.all(
    [...new Set(types)].map(async (type) => {
      try {
        if (LIVE_TYPES.includes(type)) {
          const stations = await fetchEvChargers(lat, lon, radius, controller.signal)
          return nearest(stations, lat, lon, radius)
        }
        return nearest(await loadStatic(type), lat, lon, radius)
      } catch (e) {
        console.error(`${type}:`, e.message)
        errors[type] = 'Could not load this layer right now.'
        return []
      }
    }),
  )
  const amenities = lists
    .flat()
    .sort((x, y) => x.d - y.d)
    .map(({ a, d }) => ({ ...a, distance: Math.round(d) }))
  res.json({ amenities, errors })
})

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }))

// Serve the built app when it exists (npm run build)
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, () => console.log(`SWIVEL listening on http://localhost:${PORT}`))
