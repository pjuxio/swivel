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
import ghgrpUrl from './data/ghgrp.geojson?url'
import prisonUrl from './data/prison.geojson?url'
import pfasUrl from './data/pfas_systems.geojson?url'
import iceUrl from './data/ice_office.geojson?url'
import militaryUrl from './data/military.geojson?url'

export type AmenityType = 'hospital' | 'police' | 'fire_station' | 'urgent_care' | 'data_center' | 'superfund' | 'airport' | 'train_station' | 'hate_group' | 'ghg_emitter' | 'pfas_system' | 'prison' | 'military' | 'ice_office'

export interface AmenityLayer {
  type: AmenityType
  group: LayerGroup
  label: string
  color: string
  emoji: string
  // Label shown in the UI
  source: string
  // Loads the full static dataset bundled with the app
  load: () => Promise<Amenity[]>
}

export type LayerGroup = 'public_safety' | 'transportation' | 'social' | 'demographics' | 'environmental'

export const GROUPS: { id: LayerGroup; label: string }[] = [
  { id: 'public_safety', label: 'Public Safety' },
  { id: 'transportation', label: 'Transportation' },
  { id: 'social', label: 'Social' },
  { id: 'demographics', label: 'Demographics' },
  { id: 'environmental', label: 'Environmental' },
]

const HIFLD = 'HIFLD'
const DOT = 'US DOT'

export const LAYERS: AmenityLayer[] = [
  { type: 'hospital', group: 'public_safety', label: 'Hospitals', color: '#d32f2f', emoji: '🏥', source: HIFLD, load: normalizedLoader('hospital', hospitalUrl) },
  { type: 'police', group: 'public_safety', label: 'Police', color: '#1976d2', emoji: '🚓', source: HIFLD, load: normalizedLoader('police', policeUrl) },
  { type: 'fire_station', group: 'public_safety', label: 'Fire', color: '#f57c00', emoji: '🚒', source: HIFLD, load: normalizedLoader('fire_station', fireUrl) },
  { type: 'urgent_care', group: 'public_safety', label: 'Urgent care', color: '#388e3c', emoji: '⛑️', source: HIFLD, load: normalizedLoader('urgent_care', urgentUrl) },
  { type: 'prison', group: 'public_safety', label: 'Prisons & jails', color: '#37474f', emoji: '⛓️', source: HIFLD, load: normalizedLoader('prison', prisonUrl) },
  { type: 'military', group: 'public_safety', label: 'Military installations', color: '#33691e', emoji: '🎖️', source: 'US DOT (DoD sites)', load: normalizedLoader('military', militaryUrl) },
  { type: 'ice_office', group: 'public_safety', label: 'ICE field offices', color: '#283593', emoji: '🛂', source: 'ICE ERO (community-maintained)', load: normalizedLoader('ice_office', iceUrl) },
  { type: 'airport', group: 'transportation', label: 'Airports', color: '#0277bd', emoji: '✈️', source: DOT, load: normalizedLoader('airport', airportUrl) },
  { type: 'train_station', group: 'transportation', label: 'Train stations', color: '#6d4c41', emoji: '🚆', source: 'Amtrak (US DOT)', load: normalizedLoader('train_station', trainUrl) },
  { type: 'hate_group', group: 'social', label: 'Hate & extremist groups', color: '#b71c1c', emoji: '⚠️', source: 'SPLC 2025', load: normalizedLoader('hate_group', splcUrl) },
  { type: 'data_center', group: 'environmental', label: 'Data centers', color: '#455a64', emoji: '🖥️', source: 'Open Data Center Data', load: loadDataCenters },
  { type: 'ghg_emitter', group: 'environmental', label: 'Greenhouse gas emitters', color: '#6a1b9a', emoji: '🏭', source: 'EPA GHGRP 2023', load: normalizedLoader('ghg_emitter', ghgrpUrl) },
  { type: 'pfas_system', group: 'environmental', label: 'PFAS water systems (sites)', color: '#0097a7', emoji: '💧', source: 'EPA UCMR 5', load: normalizedLoader('pfas_system', pfasUrl) },
  { type: 'superfund', group: 'environmental', label: 'Superfund sites', color: '#827717', emoji: '☣️', source: 'EPA NPL', load: loadSuperfundSites },
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

export async function geocode(q: string, signal?: AbortSignal): Promise<{ lat: number; lon: number } | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`,
    { signal },
  )
  if (!res.ok) throw new Error(`Geocoding error ${res.status}`)
  const [hit]: { lat: string; lon: string }[] = await res.json()
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null
}
