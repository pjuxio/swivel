import type { Amenity } from '../amenities'
import url from '../data/superfund_sites.geojson?url'

interface SuperfundProps {
  Site_Name: string
  Site_EPA_ID: string
  City?: string | null
  County?: string | null
  State?: string | null
  Status?: string | null
  Site_Score?: number | null
  Proposed_Date?: string | null
  Listing_Date?: string | null
  Construction_Completion_Date?: string | null
  Deletion_Date?: string | null
  Site_Progress_Profile?: string | null
  Site_Listing_Narrative?: string | null
}

interface Collection {
  features: {
    geometry: { type: string; coordinates: [number, number] } | null
    properties: SuperfundProps
  }[]
}

let cache: Promise<Amenity[]> | undefined

// The source embeds links as HTML anchors; extract only http(s) hrefs
function hrefOf(html?: string | null): string | undefined {
  const m = html?.match(/href="(https?:\/\/[^"]+)"/)
  return m?.[1]
}

function parse(json: Collection): Amenity[] {
  const out: Amenity[] = []
  for (const f of json.features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    const [lon, lat] = f.geometry.coordinates
    const details: { label: string; value: string }[] = []
    const add = (label: string, value?: string | number | null) => {
      if (value !== undefined && value !== null && value !== '') details.push({ label, value: String(value) })
    }
    add('Status', p.Status)
    add('EPA ID', p.Site_EPA_ID)
    add('Hazard score', p.Site_Score)
    add('Proposed', p.Proposed_Date)
    add('Listed', p.Listing_Date)
    add('Construction complete', p.Construction_Completion_Date)
    add('Deleted', p.Deletion_Date)

    const links: { title: string; url: string }[] = []
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

export function loadSuperfundSites(): Promise<Amenity[]> {
  cache ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Superfund dataset error ${r.status}`)
      return r.json() as Promise<Collection>
    })
    .then(parse)
    .catch((e) => {
      cache = undefined
      throw e
    })
  return cache
}
