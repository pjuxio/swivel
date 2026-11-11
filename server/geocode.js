// Nominatim proxy: the browser never talks to the geocoder directly, reverse lookups use coarse coordinates,
// and requests are cached and spaced out per the usage policy (https://operations.osmfoundation.org/policies/nominatim/)
const BASE = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org'
const CONTACT = process.env.NOMINATIM_EMAIL
const USER_AGENT = `SWIVEL/1.0 (situational-awareness map${CONTACT ? `; ${CONTACT}` : ''})`
const TTL_MS = 24 * 60 * 60 * 1000
const MIN_GAP_MS = 1100
const MAX_CACHE = 2000

/** @type {Map<string, { at: number, value: unknown }>} */
const cache = new Map()
let queue = Promise.resolve()
let last = 0

/** @param {URLSearchParams} params @param {string} path @param {AbortSignal} [signal] */
async function nominatim(path, params, signal) {
  if (CONTACT) params.set('email', CONTACT)
  const key = `${path}?${params}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  // One request at a time, at most one per second
  const run = queue.then(async () => {
    const wait = last + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    const timeout = AbortSignal.timeout(10_000)
    const res = await fetch(`${BASE}${path}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!res.ok) throw new Error(`Geocoder returned ${res.status}`)
    return res.json()
  })
  queue = run.then(
    () => {},
    () => {},
  )
  const value = await run
  if (cache.size >= MAX_CACHE) cache.delete(/** @type {string} */ (cache.keys().next().value))
  cache.set(key, { at: Date.now(), value })
  return value
}

// ~1.1 km of latitude; plenty for naming the town or neighbourhood
export const REVERSE_PRECISION = 2

/** @param {number} lat @param {number} lon @param {AbortSignal} [signal] @returns {Promise<string>} */
export async function reverseGeocode(lat, lon, signal) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    zoom: '14',
    lat: lat.toFixed(REVERSE_PRECISION),
    lon: lon.toFixed(REVERSE_PRECISION),
  })
  const { address = {}, display_name } = /** @type {{ address?: Record<string, string>, display_name?: string }} */ (
    await nominatim('/reverse', params, signal)
  )
  const locality = address.city ?? address.town ?? address.village ?? address.suburb ?? address.hamlet ?? address.county
  return [locality, address.state].filter(Boolean).join(', ') || display_name || 'Unknown location'
}

/** @param {string} q @param {AbortSignal} [signal] @returns {Promise<{ lat: number, lon: number } | null>} */
export async function geocode(q, signal) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'us', q })
  const [hit] = /** @type {{ lat: string, lon: string }[]} */ (await nominatim('/search', params, signal))
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null
}
