const KEY = process.env.NLR_API_KEY
const BASE = 'https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json'
const TTL_MS = 10 * 60 * 1000
const MAX_STATIONS = 200 // API page limit
const MILES_PER_METER = 1 / 1609.344

if (!KEY) console.warn('NLR_API_KEY is not set; EV charger lookups use the shared DEMO_KEY and will be rate limited.')

const cache = new Map()

function toAmenity(s) {
  const ports = [
    ['DC fast', s.ev_dc_fast_num],
    ['Level 2', s.ev_level2_evse_num],
    ['Level 1', s.ev_level1_evse_num],
  ].filter(([, n]) => n)
  const details = []
  if (s.ev_network && s.ev_network !== 'Non-Networked') details.push({ label: 'Network', value: s.ev_network })
  if (ports.length) details.push({ label: 'Ports', value: ports.map(([l, n]) => `${l}: ${n}`).join(', ') })
  if (s.access_days_time) details.push({ label: 'Hours', value: s.access_days_time })
  return {
    id: `ev/${s.id}`,
    type: 'ev_charger',
    name: s.station_name || 'EV charging station',
    lat: s.latitude,
    lon: s.longitude,
    address: [s.street_address, s.city, s.state].filter(Boolean).join(', ') || undefined,
    phone: s.station_phone || undefined,
    details,
  }
}

// Public EV stations near a point from the DOE Alternative Fuels Data Center (served by NLR)
export async function fetchEvChargers(lat, lon, radiusM, signal) {
  // Round the point so nearby searches share a cached response
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${Math.round(radiusM / 500)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.stations

  const params = new URLSearchParams({
    api_key: KEY || 'DEMO_KEY',
    latitude: lat,
    longitude: lon,
    radius: (radiusM * MILES_PER_METER).toFixed(2),
    fuel_type: 'ELEC',
    status: 'E',
    access: 'public',
    limit: MAX_STATIONS,
  })
  const res = await fetch(`${BASE}?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
  if (!res.ok) throw new Error(`EV charger service returned ${res.status}`)
  const json = await res.json()
  const stations = (json.fuel_stations ?? []).filter((s) => s.latitude != null && s.longitude != null).map(toAmenity)

  if (cache.size > 500) cache.delete(cache.keys().next().value)
  cache.set(key, { at: Date.now(), stations })
  return stations
}
