import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inUS } from './geo.js'

/**
 * @typedef {{ label: string, value: string }} Detail
 * @typedef {{ id: string, type: string, name: string, lat: number, lon: number, address?: string, phone?: string,
 *   website?: string, details?: Detail[], links?: { title: string, url: string }[] }} Amenity
 */

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')

/** @param {string} file @returns {Promise<any>} */
const readJson = async (file) => JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf-8'))

/**
 * An absolute http(s) URL, or undefined. Bare hosts such as `www.example.org/path` get an https:// prefix.
 * @param {unknown} u
 */
export function httpUrl(u) {
  if (typeof u !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const s = u.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\s]/g, '')
  if (!s) return undefined
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#:]|$)/i.test(s) ? `https://${s}` : null
  if (!withScheme) return undefined
  try {
    const url = new URL(withScheme)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/** Points outside the US (bad geocodes, 0,0, Freely Associated States) are dropped. @param {Amenity[]} list */
const usOnly = (list) => list.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && inUS(a.lat, a.lon))

// The database also lists places it judged not to be sundown towns ("Unlikely", "Black town or township", ...)
export const SUNDOWN_STATUSES = new Set(['Surely', 'Probable', 'Possible'])

/** @param {Amenity} a */
function sundownFixup(a) {
  const status = a.details?.find((d) => d.label === 'Sundown town?')?.value
  if (!status || !SUNDOWN_STATUSES.has(status)) return null
  // Older builds stored the status in `address`
  return { ...a, address: a.address?.startsWith('Sundown town?') ? undefined : a.address }
}

/** @type {Record<string, (a: Amenity) => Amenity | null>} */
const FIXUPS = { sundown_town: sundownFixup }

// GeoJSON written by scripts/*.py: properties carry id, name, address, phone, website and details as [label, value]
/** @param {string} type @param {string} file */
function normalized(type, file) {
  return async () => {
    const json = await readJson(file)
    /** @type {Amenity[]} */
    const out = []
    for (const f of json.features) {
      if (f.geometry?.type !== 'Point') continue
      const p = f.properties
      const [lon, lat] = f.geometry.coordinates
      /** @type {Amenity | null} */
      let a = {
        id: p.id,
        type,
        name: p.name,
        lat,
        lon,
        address: p.address || undefined,
        phone: p.phone || undefined,
        website: httpUrl(p.website),
        details: p.details?.map((/** @type {[string, string]} */ [label, value]) => ({ label, value })),
      }
      if (FIXUPS[type]) a = FIXUPS[type](a)
      if (a) out.push(a)
    }
    return usOnly(out)
  }
}

async function loadDataCenters() {
  const json = await readJson('data_centers.geojson')
  /** @type {Amenity[]} */
  const out = []
  for (const f of json.features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    const [lon, lat] = f.geometry.coordinates
    /** @type {Detail[]} */
    const details = []
    /** @param {string} label @param {unknown} value */
    const add = (label, value, suffix = '') => {
      if (value !== undefined && value !== '') details.push({ label, value: `${value}${suffix}` })
    }
    add('Company', p.company)
    add('Status', p.status)
    add('Capacity', p.megawatts, ' MW')
    add('Site', p.acres, ' acres')
    add('Investment', p.investment ? `$${p.investment.toLocaleString('en-US')}` : undefined)
    add('Power', p.power)
    add('Announced', p.announced)
    out.push({
      id: `dc/${p.id}`,
      type: 'data_center',
      name: p.name,
      lat,
      lon,
      address: [p.city, p.county && `${p.county} County`, p.state].filter(Boolean).join(', ') || undefined,
      details,
      links: (p.sources ?? [])
        .map((/** @type {{ url?: string, title?: string }} */ s) => ({ url: httpUrl(s.url), title: s.title || s.url }))
        .filter((/** @type {{ url?: string }} */ s) => s.url),
    })
  }
  return usOnly(out)
}

// The source embeds links as HTML anchors; extract only http(s) hrefs
/** @param {string | undefined} html */
const hrefOf = (html) => html?.match(/href="(https?:\/\/[^"]+)"/)?.[1]

async function loadSuperfund() {
  const json = await readJson('superfund_sites.geojson')
  /** @type {Amenity[]} */
  const out = []
  for (const f of json.features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    const [lon, lat] = f.geometry.coordinates
    /** @type {Detail[]} */
    const details = []
    /** @param {string} label @param {unknown} value */
    const add = (label, value) => {
      if (value !== undefined && value !== null && value !== '') details.push({ label, value: String(value) })
    }
    add('Status', p.Status)
    add('EPA ID', p.Site_EPA_ID)
    add('Hazard score', p.Site_Score)
    add('Proposed', p.Proposed_Date)
    add('Listed', p.Listing_Date)
    add('Construction complete', p.Construction_Completion_Date)
    add('Deleted', p.Deletion_Date)
    const links = []
    const profile = hrefOf(p.Site_Progress_Profile)
    if (profile) links.push({ title: 'EPA site progress profile', url: profile })
    const narrative = hrefOf(p.Site_Listing_Narrative)
    if (narrative) links.push({ title: 'Listing narrative (PDF)', url: narrative })
    out.push({
      id: `superfund/${p.Site_EPA_ID}`,
      type: 'superfund',
      name: p.Site_Name,
      lat,
      lon,
      address: [p.City, p.County && `${p.County} County`, p.State].filter(Boolean).join(', ') || undefined,
      details,
      links,
    })
  }
  return usOnly(out)
}

/** @type {Record<string, () => Promise<Amenity[]>>} */
const LOADERS = {
  hospital: normalized('hospital', 'hospital.geojson'),
  police: normalized('police', 'police.geojson'),
  fire_station: normalized('fire_station', 'fire_station.geojson'),
  urgent_care: normalized('urgent_care', 'urgent_care.geojson'),
  prison: normalized('prison', 'prison.geojson'),
  military: normalized('military', 'military.geojson'),
  ice_office: normalized('ice_office', 'ice_office.geojson'),
  airport: normalized('airport', 'airport.geojson'),
  train_station: normalized('train_station', 'train_station.geojson'),
  hate_group: normalized('hate_group', 'splc_hate.geojson'),
  sundown_town: normalized('sundown_town', 'sundown_towns.geojson'),
  ghg_emitter: normalized('ghg_emitter', 'ghgrp.geojson'),
  pfas_system: normalized('pfas_system', 'pfas_systems.geojson'),
  tri: normalized('tri', 'tri.geojson'),
  brownfield: normalized('brownfield', 'brownfield.geojson'),
  landfill: normalized('landfill', 'landfill.geojson'),
  data_center: loadDataCenters,
  superfund: loadSuperfund,
}

export const STATIC_TYPES = Object.keys(LOADERS)

/** @type {Map<string, Promise<Amenity[]>>} */
const cache = new Map()

// Each dataset is parsed once, on first use, and kept in memory
/** @param {string} type @returns {Promise<Amenity[]>} */
export function loadStatic(type) {
  let hit = cache.get(type)
  if (!hit) {
    hit = LOADERS[type]().catch((e) => {
      cache.delete(type)
      throw e
    })
    cache.set(type, hit)
  }
  return hit
}
