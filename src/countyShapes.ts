import type { FeatureCollection } from 'geojson'

let counties: Promise<FeatureCollection> | null = null

// County shapes (TopoJSON) are loaded on demand and shared between choropleth layers
export function loadCounties(): Promise<FeatureCollection> {
  counties ??= Promise.all([import('./data/counties.topo.json'), import('topojson-client')]).then(
    ([topo, { feature }]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = topo.default as any
      return feature(t, t.objects.counties) as unknown as FeatureCollection
    },
  )
  return counties
}

let acsShapes: Promise<FeatureCollection> | null = null

// ACS keys Connecticut by planning region, so swap them in for the old CT counties
export function loadAcsShapes(): Promise<FeatureCollection> {
  acsShapes ??= Promise.all([loadCounties(), import('./data/ct_regions.json')]).then(([counties, ct]) => ({
    type: 'FeatureCollection',
    features: [
      ...counties.features.filter((f) => !String(f.id).startsWith('09')),
      ...(ct.default as unknown as FeatureCollection).features,
    ],
  }))
  return acsShapes
}
