import type { Amenity, AmenityType } from '../amenities'

interface Collection {
  features: {
    geometry: { coordinates: [number, number] }
    properties: {
      id: string
      name: string
      address?: string
      phone?: string
      website?: string
      details?: [string, string][]
    }
  }[]
}

// Loads a GeoJSON file produced by scripts/fetch_datasets.py
export function normalizedLoader(type: AmenityType, url: string): () => Promise<Amenity[]> {
  let cache: Promise<Amenity[]> | undefined
  return () => {
    cache ??= fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Dataset error ${r.status}`)
        return r.json() as Promise<Collection>
      })
      .then((json) =>
        json.features.map((f) => {
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
            website: p.website && /^https?:\/\//.test(p.website) ? p.website : undefined,
            details: p.details?.map(([label, value]) => ({ label, value })),
          }
        }),
      )
      .catch((e) => {
        cache = undefined
        throw e
      })
    return cache
  }
}
