import type { Amenity } from '../amenities'
import url from '../data/data_centers.geojson?url'

interface DataCenterProps {
  id: string
  name: string
  company?: string
  city?: string
  state?: string
  county?: string
  status?: string
  megawatts?: number
  acres?: number
  investment?: number
  power?: string
  announced?: string
  sources?: { url: string; title?: string }[]
}

interface Collection {
  features: {
    geometry: { type: string; coordinates: [number, number] } | null
    properties: DataCenterProps
  }[]
}

let cache: Promise<Amenity[]> | undefined

function parse(json: Collection): Amenity[] {
  const out: Amenity[] = []
  for (const f of json.features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    const [lon, lat] = f.geometry.coordinates
    const details: { label: string; value: string }[] = []
    const add = (label: string, value: string | number | undefined, suffix = '') => {
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
        .filter((s) => /^https?:\/\//.test(s.url))
        .map((s) => ({ url: s.url, title: s.title || s.url })),
    })
  }
  return out
}

export function loadDataCenters(): Promise<Amenity[]> {
  cache ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Data center dataset error ${r.status}`)
      return r.json() as Promise<Collection>
    })
    .then(parse)
    .catch((e) => {
      cache = undefined
      throw e
    })
  return cache
}
