import { loadDataCenters } from './datasets/dataCenters'
import { loadSuperfundSites } from './datasets/superfund'
import { normalizedLoader } from './datasets/normalized'
import hospitalUrl from './data/hospital.geojson?url'
import policeUrl from './data/police.geojson?url'
import fireUrl from './data/fire_station.geojson?url'
import urgentUrl from './data/urgent_care.geojson?url'
import airportUrl from './data/airport.geojson?url'
import trainUrl from './data/train_station.geojson?url'
import splcUrl from './data/splc_hate.geojson?url'

export type AmenityType = 'hospital' | 'police' | 'fire_station' | 'urgent_care' | 'data_center' | 'superfund' | 'airport' | 'train_station' | 'hate_group'

export interface AmenityLayer {
  type: AmenityType
  label: string
  color: string
  emoji: string
  // Label shown in the UI
  source: string
  // Loads the full static dataset bundled with the app
  load: () => Promise<Amenity[]>
}

const HIFLD = 'HIFLD'
const DOT = 'US DOT'

export const LAYERS: AmenityLayer[] = [
  { type: 'hospital', label: 'Hospitals', color: '#d32f2f', emoji: '🏥', source: HIFLD, load: normalizedLoader('hospital', hospitalUrl) },
  { type: 'police', label: 'Police', color: '#1976d2', emoji: '🚓', source: HIFLD, load: normalizedLoader('police', policeUrl) },
  { type: 'fire_station', label: 'Fire', color: '#f57c00', emoji: '🚒', source: HIFLD, load: normalizedLoader('fire_station', fireUrl) },
  { type: 'urgent_care', label: 'Urgent care', color: '#388e3c', emoji: '⛑️', source: HIFLD, load: normalizedLoader('urgent_care', urgentUrl) },
  { type: 'airport', label: 'Airports', color: '#0277bd', emoji: '✈️', source: DOT, load: normalizedLoader('airport', airportUrl) },
  { type: 'train_station', label: 'Train stations', color: '#6d4c41', emoji: '🚆', source: 'Amtrak (US DOT)', load: normalizedLoader('train_station', trainUrl) },
  { type: 'hate_group', label: 'Hate & extremist groups', color: '#b71c1c', emoji: '⚠️', source: 'SPLC 2025', load: normalizedLoader('hate_group', splcUrl) },
  { type: 'data_center', label: 'Data centers', color: '#455a64', emoji: '🖥️', source: 'Open Data Center Data', load: loadDataCenters },
  { type: 'superfund', label: 'Superfund sites', color: '#827717', emoji: '☣️', source: 'EPA NPL', load: loadSuperfundSites },
]

export const MAX_RESULTS = 300

export interface Amenity {
  id: string
  type: AmenityType
  name: string
  lat: number
  lon: number
  address?: string
  phone?: string
  website?: string
  openingHours?: string
  details?: { label: string; value: string }[]
  links?: { title: string; url: string }[]
}

export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function nearest(items: Amenity[], lat: number, lon: number, radiusM: number): Amenity[] {
  return items
    .filter((a) => distanceMeters(lat, lon, a.lat, a.lon) <= radiusM)
    .sort((a, b) => distanceMeters(lat, lon, a.lat, a.lon) - distanceMeters(lat, lon, b.lat, b.lon))
}

export async function fetchAmenities(
  lat: number,
  lon: number,
  radiusM: number,
  types: AmenityType[],
  signal?: AbortSignal,
): Promise<Amenity[]> {
  const results = await Promise.all(
    LAYERS.filter((l) => types.includes(l.type)).map(async (l) =>
      nearest(await l.load(), lat, lon, radiusM).slice(0, MAX_RESULTS),
    ),
  )
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return nearest(results.flat(), lat, lon, Infinity)
}

interface NominatimResult {
  display_name?: string
  address?: Record<string, string>
}

export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`,
    { signal },
  )
  if (!res.ok) throw new Error(`Geocoding error ${res.status}`)
  const { address = {}, display_name }: NominatimResult = await res.json()
  const locality = address.city ?? address.town ?? address.village ?? address.suburb ?? address.hamlet ?? address.county
  return [locality, address.state].filter(Boolean).join(', ') || display_name || 'Unknown location'
}
