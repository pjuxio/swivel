
export type AmenityType = 'hospital' | 'police' | 'fire_station' | 'urgent_care' | 'data_center' | 'superfund' | 'airport' | 'train_station' | 'hate_group' | 'ghg_emitter' | 'pfas_system' | 'prison' | 'military' | 'ice_office' | 'tri' | 'brownfield' | 'landfill' | 'ev_charger'

export interface AmenityLayer {
  type: AmenityType
  group: LayerGroup
  label: string
  color: string
  emoji: string
  // Label shown in the UI
  source: string
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
  { type: 'hospital', group: 'public_safety', label: 'Hospitals', color: '#d32f2f', emoji: '🏥', source: HIFLD },
  { type: 'police', group: 'public_safety', label: 'Police', color: '#1976d2', emoji: '🚓', source: HIFLD },
  { type: 'fire_station', group: 'public_safety', label: 'Fire', color: '#f57c00', emoji: '🚒', source: HIFLD },
  { type: 'urgent_care', group: 'public_safety', label: 'Urgent care', color: '#388e3c', emoji: '⛑️', source: HIFLD },
  { type: 'prison', group: 'public_safety', label: 'Prisons & jails', color: '#37474f', emoji: '⛓️', source: HIFLD },
  { type: 'military', group: 'public_safety', label: 'Military installations', color: '#33691e', emoji: '🎖️', source: 'US DOT (DoD sites)' },
  { type: 'ev_charger', group: 'transportation', label: 'EV charging stations', color: '#00897b', emoji: '🔌', source: 'DOE AFDC' },
  { type: 'ice_office', group: 'public_safety', label: 'ICE field offices', color: '#283593', emoji: '🛂', source: 'ICE ERO (community-maintained)' },
  { type: 'airport', group: 'transportation', label: 'Airports', color: '#0277bd', emoji: '✈️', source: DOT },
  { type: 'train_station', group: 'transportation', label: 'Train stations', color: '#6d4c41', emoji: '🚆', source: 'Amtrak (US DOT)' },
  { type: 'hate_group', group: 'social', label: 'Hate & extremist groups', color: '#b71c1c', emoji: '⚠️', source: 'SPLC 2025' },
  { type: 'data_center', group: 'environmental', label: 'Data centers', color: '#455a64', emoji: '🖥️', source: 'Open Data Center Data' },
  { type: 'ghg_emitter', group: 'environmental', label: 'Greenhouse gas emitters', color: '#6a1b9a', emoji: '🏭', source: 'EPA GHGRP 2023' },
  { type: 'pfas_system', group: 'environmental', label: 'PFAS water systems (sites)', color: '#0097a7', emoji: '💧', source: 'EPA UCMR 5' },
  { type: 'tri', group: 'environmental', label: 'Toxic release (TRI) facilities', color: '#ad1457', emoji: '🧪', source: 'EPA TRI via FRS' },
  { type: 'brownfield', group: 'environmental', label: 'Brownfield sites', color: '#8d6e63', emoji: '🏚️', source: 'EPA ACRES via FRS' },
  { type: 'landfill', group: 'environmental', label: 'Landfills', color: '#5d4037', emoji: '🗑️', source: 'EPA LMOP' },
  { type: 'superfund', group: 'environmental', label: 'Superfund sites', color: '#827717', emoji: '☣️', source: 'EPA NPL' },
]

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

export interface AmenityResults {
  amenities: Amenity[]
  // Layers the server could not load, keyed by type
  errors: Partial<Record<AmenityType, string>>
}

// Searches are served by our own API (server/index.js)
export async function fetchAmenities(
  lat: number,
  lon: number,
  radiusM: number,
  types: AmenityType[],
  signal?: AbortSignal,
): Promise<AmenityResults> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: String(radiusM), types: types.join(',') })
  const res = await fetch(`/api/amenities?${params}`, { signal })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Search failed (${res.status})`)
  }
  return res.json()
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
