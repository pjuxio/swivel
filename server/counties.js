import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { feature } from 'topojson-client'
import { circleTouchesRing, outerRings } from './geo.js'

// The same county shapes the browser uses for the shading layers
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'counties.topo.json')

/** @typedef {{ id: string, rings: import('./geo.js').Ring[], bbox: [number, number, number, number] }} County */
/** @type {County[] | null} */
let counties = null

/** @returns {County[]} */
function load() {
  if (counties) return counties
  const topo = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const fc = /** @type {import('geojson').FeatureCollection} */ (/** @type {unknown} */ (feature(topo, topo.objects.counties)))
  counties = fc.features.map((f) => {
    const rings = outerRings(f.geometry)
    const pts = rings.flat()
    const lons = pts.map((p) => p[0])
    const lats = pts.map((p) => p[1])
    return {
      id: String(f.id),
      rings,
      bbox: [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)],
    }
  })
  return counties
}

/**
 * 5-digit FIPS codes of the counties that touch a circle.
 * @param {number} lat @param {number} lon @param {number} radiusM
 */
export function countiesNear(lat, lon, radiusM) {
  const dLat = radiusM / 110_000 // cheap bounding box before the exact test
  const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  const out = new Set()
  for (const c of load()) {
    const [minLat, maxLat, minLon, maxLon] = c.bbox
    if (lat + dLat < minLat || lat - dLat > maxLat || lon + dLon < minLon || lon - dLon > maxLon) continue
    if (c.rings.some((ring) => circleTouchesRing(lat, lon, radiusM, ring))) out.add(c.id)
  }
  return out
}
