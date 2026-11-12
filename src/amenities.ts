import type { MultiPolygon, Polygon } from 'geojson'


export type AmenityType = 'hospital' | 'police' | 'fire_station' | 'urgent_care' | 'data_center' | 'superfund' | 'airport' | 'train_station' | 'ghg_emitter' | 'pfas_system' | 'prison' | 'military' | 'ice_office' | 'tri' | 'brownfield' | 'landfill' | 'ev_charger' | 'sundown_town'

export interface AmenityLayer {
  type: AmenityType
  group: LayerGroup
  label: string
  color: string
  emoji: string
  // Label shown in the UI
  source: string
}

export type LayerGroup = 'public_safety' | 'transportation' | 'social' | 'demographics' | 'environmental' | 'tech'

export const GROUPS: { id: LayerGroup; label: string }[] = [
  { id: 'public_safety', label: 'Public Safety' },
  { id: 'transportation', label: 'Transportation' },
  { id: 'environmental', label: 'Environmental' },
  { id: 'social', label: 'Historical' },
  { id: 'demographics', label: 'Demographics' },
  { id: 'tech', label: 'Tech' },
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
  { type: 'sundown_town', group: 'social', label: 'Sundown towns (historical)', color: '#880e4f', emoji: '🌇', source: 'Tougaloo College Sundown Towns Database' },
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
  // Meters from the search point, computed by the server
  distance: number
  address?: string
  phone?: string
  website?: string
  details?: { label: string; value: string }[]
  links?: { title: string; url: string }[]
}

export interface AmenityResults {
  amenities: Amenity[]
  // Per layer: how many came back and how many were in the radius before the server's cap
  counts: Partial<Record<AmenityType, { shown: number; total: number }>>
  // Layers the server could not load, keyed by type
  errors: Partial<Record<AmenityType, string>>
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw new Error(json?.error ?? `Request failed (${res.status})`)
  }
  return res.json()
}

// Searches are served by our own API (server/app.js); the point travels in the body, not the URL
export function fetchAmenities(
  lat: number,
  lon: number,
  radius: number,
  types: AmenityType[],
  signal?: AbortSignal,
): Promise<AmenityResults> {
  return post('/api/amenities', { lat, lon, radius, types }, signal)
}

// Geocoding is proxied by the server, which rounds the point before asking Nominatim
export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  return (await post<{ name: string }>('/api/reverse', { lat, lon }, signal)).name
}

export async function geocode(q: string, signal?: AbortSignal): Promise<{ lat: number; lon: number } | null> {
  return (await post<{ hit: { lat: number; lon: number } | null }>('/api/geocode', { q }, signal)).hit
}

export interface WeatherAlert {
  id: string
  event: string
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'
  headline?: string
  areaDesc?: string
  sender?: string
  description?: string
  instruction?: string
  // ISO time the alert ends or expires
  expires?: string
  // In effect at the search point itself, as opposed to elsewhere within the radius
  atPoint: boolean
  // Warning polygon, when NWS drew one; county or zone alerts have none
  geometry?: Polygon | MultiPolygon
}

// Active National Weather Service alerts at a point or within a radius (meters) of it, fetched through our server
export async function fetchAlerts(lat: number, lon: number, radius: number, signal?: AbortSignal): Promise<WeatherAlert[]> {
  return (await post<{ alerts: WeatherAlert[] }>('/api/alerts', { lat, lon, radius }, signal)).alerts
}
