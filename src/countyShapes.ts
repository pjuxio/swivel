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
