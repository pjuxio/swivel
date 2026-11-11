/** @param {number} aLat @param {number} aLon @param {number} bLat @param {number} bLon */
export function distanceMeters(aLat, aLon, bLat, bLon) {
  const rad = (/** @type {number} */ d) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/**
 * Items within radiusM of the point, nearest first, cut to `limit`. `total` is the count before the cut.
 * @template {{ lat: number, lon: number }} T
 * @param {T[]} items @param {number} lat @param {number} lon @param {number} radiusM @param {number} limit
 * @returns {{ hits: { a: T, d: number }[], total: number }}
 */
export function nearest(items, lat, lon, radiusM, limit) {
  const dLat = radiusM / 111_000 // cheap bounding box before the exact distance
  const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  const out = []
  for (const a of items) {
    if (Math.abs(a.lat - lat) > dLat || Math.abs(a.lon - lon) > dLon) continue
    const d = distanceMeters(lat, lon, a.lat, a.lon)
    if (d <= radiusM) out.push({ a, d })
  }
  out.sort((x, y) => x.d - y.d)
  return { hits: out.slice(0, limit), total: out.length }
}

// Rough boxes around the 50 states, DC and the inhabited territories
/** @type {[number, number, number, number][]} [minLat, maxLat, minLon, maxLon] */
const US_BOXES = [
  [24.3, 49.5, -125, -66.9], // contiguous US
  [51, 71.6, -180, -129.9], // Alaska
  [51, 53, 172, 180], // Aleutians west of the antimeridian
  [18.8, 22.4, -160.6, -154.7], // Hawaii
  [17.6, 18.6, -67.4, -64.5], // Puerto Rico and USVI
  [13.2, 20.6, 144.5, 146.1], // Guam and Northern Marianas
  [-14.6, -11, -171.2, -168.1], // American Samoa
]

/** @param {number} lat @param {number} lon */
export function inUS(lat, lon) {
  return US_BOXES.some(([a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d)
}
