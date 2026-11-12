import { countiesNear } from './counties.js'
import { circleTouchesRing, outerRings } from './geo.js'

// Active weather alerts from the National Weather Service (https://www.weather.gov/documentation/services-web-api).
// The API needs no key but asks for an identifying User-Agent. Only the server talks to it.
const BASE = process.env.NWS_URL || 'https://api.weather.gov'
const CONTACT = process.env.NWS_CONTACT || process.env.NOMINATIM_EMAIL
const USER_AGENT = `SWIVEL/1.0 (situational-awareness map${CONTACT ? `; ${CONTACT}` : ''})`
const TTL_MS = 2 * 60 * 1000 // NWS refreshes alerts about every minute; this keeps us well under its limits
const MAX_ALERTS = 50
const MAX_TEXT = 2000
const MAX_CACHE = 500

/** Most severe first. */
const SEVERITIES = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']

/**
 * @typedef {{
 *   id: string, event: string, severity: string, headline?: string, areaDesc?: string, sender?: string,
 *   description?: string, instruction?: string, expires?: string,
 * }} WeatherAlert
 * @typedef {WeatherAlert & { atPoint: boolean, geometry?: object }} NearbyAlert
 */

/** Alerts in effect at one point. @type {Map<string, { at: number, alerts: WeatherAlert[] }>} */
const cache = new Map()

/** @param {unknown} v @param {number} [max] */
const text = (v, max = MAX_TEXT) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/** @param {any} p an NWS alert's `properties` @returns {WeatherAlert | null} */
export function toAlert(p) {
  if (!p || p.status !== 'Actual' || p.messageType === 'Cancel') return null
  const expires = Date.parse(p.ends ?? p.expires)
  if (expires < Date.now()) return null
  const event = text(p.event, 100)
  if (!event) return null
  return {
    id: String(p.id),
    event,
    severity: SEVERITIES.includes(p.severity) ? p.severity : 'Unknown',
    headline: text(p.headline, 300),
    areaDesc: text(p.areaDesc, 300),
    sender: text(p.senderName, 100),
    description: text(p.description),
    instruction: text(p.instruction),
    expires: Number.isNaN(expires) ? undefined : new Date(expires).toISOString(),
  }
}

/** @param {string} url @param {AbortSignal} [signal] */
async function nws(url, signal) {
  const timeout = AbortSignal.timeout(10_000)
  return fetch(`${BASE}${url}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
}

/**
 * Alerts in effect at a point, from NWS's own zone lookup. The point is rounded to about 100 m so nearby lookups
 * share a cached response.
 * @param {number} lat @param {number} lon @param {AbortSignal} [signal]
 * @returns {Promise<WeatherAlert[]>}
 */
async function alertsAtPoint(lat, lon, signal) {
  const point = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = cache.get(point)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.alerts

  const res = await nws(`/alerts/active?${new URLSearchParams({ point })}`, signal)
  // Points outside NWS coverage are a 400, which just means no alerts
  if (res.status === 400) return []
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
  const json = /** @type {{ features?: { properties?: unknown }[] }} */ (await res.json())
  const alerts = (json.features ?? []).map((f) => toAlert(f.properties)).filter((a) => a !== null)

  if (cache.size >= MAX_CACHE) cache.delete(/** @type {string} */ (cache.keys().next().value))
  cache.set(point, { at: Date.now(), alerts })
  return alerts
}

/** @typedef {{ alert: WeatherAlert, counties: string[], geometry: any }} Entry */
/** Every active alert in the country, shared by all requests. @type {{ at: number, entries: Entry[] } | null} */
let national = null
/** @type {Promise<Entry[]> | null} */
let nationalLoading = null

/** @returns {Promise<Entry[]>} */
async function allAlerts() {
  if (national && Date.now() - national.at < TTL_MS) return national.entries
  // One shared request; a single client hanging up must not cancel it for everyone
  nationalLoading ??= (async () => {
    try {
      const res = await nws('/alerts/active?status=actual')
      if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
      const json = /** @type {{ features?: { properties?: any, geometry?: any }[] }} */ (await res.json())
      /** @type {Entry[]} */
      const entries = []
      for (const f of json.features ?? []) {
        const alert = toAlert(f.properties)
        if (!alert) continue
        // SAME codes are "0" + the 5-digit county FIPS
        const same = Array.isArray(f.properties.geocode?.SAME) ? f.properties.geocode.SAME : []
        entries.push({ alert, counties: same.map((/** @type {string} */ c) => String(c).slice(1)), geometry: f.geometry })
      }
      national = { at: Date.now(), entries }
      return entries
    } finally {
      nationalLoading = null
    }
  })()
  return nationalLoading
}

/**
 * Alerts that apply at a point or anywhere inside a circle around it, most severe first. Alerts in effect at the
 * point itself are flagged `atPoint`. Others are kept when their polygon touches the circle or, for alerts that only
 * name counties, when one of those counties does. Polygons are included so the map can draw them.
 * @param {number} lat @param {number} lon @param {number} radiusM @param {AbortSignal} [signal]
 * @returns {Promise<NearbyAlert[]>}
 */
export async function fetchAlerts(lat, lon, radiusM, signal) {
  const [here, entries] = await Promise.all([alertsAtPoint(lat, lon, signal), radiusM > 0 ? allAlerts() : []])
  /** @type {Map<string, NearbyAlert>} */
  const found = new Map(here.map((a) => [a.id, { ...a, atPoint: true }]))

  if (entries.length) {
    const near = countiesNear(lat, lon, radiusM)
    for (const { alert, counties, geometry } of entries) {
      const rings = outerRings(geometry)
      const known = found.get(alert.id)
      if (known) {
        if (rings.length) known.geometry = geometry
      } else if (rings.length ? rings.some((r) => circleTouchesRing(lat, lon, radiusM, r)) : counties.some((c) => near.has(c))) {
        found.set(alert.id, { ...alert, atPoint: false, ...(rings.length ? { geometry } : {}) })
      }
    }
  }

  return [...found.values()]
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || Number(b.atPoint) - Number(a.atPoint))
    .slice(0, MAX_ALERTS)
}
