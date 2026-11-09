import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')

const readJson = async (file) => JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf-8'))
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : undefined)

// GeoJSON written by scripts/*.py: properties carry id, name, address, phone, website and details as [label, value]
function normalized(type, file) {
  return async () => {
    const json = await readJson(file)
    return json.features.map((f) => {
      const p = f.properties
      const [lon, lat] = f.geometry.coordinates
      return {
        id: p.id,
        type,
        name: p.name,
        lat,
        lon,
        address: p.address,
        phone: p.phone,
        website: httpUrl(p.website),
        details: p.details?.map(([label, value]) => ({ label, value })),
      }
    })
  }
}

async function loadDataCenters() {
  const json = await readJson('data_centers.geojson')
  const out = []
  for (const f of json.features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    const [lon, lat] = f.geometry.coordinates
    const details = []
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
      links: (p.sources ?? []).filter((s) => httpUrl(s.url)).map((s) => ({ url: s.url, title: s.title || s.url })),
    })
  }
  return out
}

// The source embeds links as HTML anchors; extract only http(s) hrefs
const hrefOf = (html) => html?.match(/href="(https?:\/\/[^"]+)"/)?.[1]

async function loadSuperfund() {
  const json = await readJson('superfund_sites.geojson')
  const out = []
  for (const f of json.features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    const [lon, lat] = f.geometry.coordinates
    const details = []
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
  return out
}

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

const cache = new Map()

// Each dataset is parsed once, on first use, and kept in memory
export function loadStatic(type) {
  if (!cache.has(type)) {
    cache.set(
      type,
      LOADERS[type]().catch((e) => {
        cache.delete(type)
        throw e
      }),
    )
  }
  return cache.get(type)
}
