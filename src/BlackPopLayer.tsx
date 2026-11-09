import { useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { Layer } from 'leaflet'
import { GeoJSON, Pane } from 'react-leaflet'
import { loadCounties } from './countyShapes'

type Row = { pct: number; name: string }
type BlackPop = Record<string, Row>

// [minimum %, fill color], highest first
const SCALE: [number, string][] = [
  [55, '#54278f'],
  [35, '#756bb1'],
  [20, '#9e9ac8'],
  [10, '#bcbddc'],
  [2, '#efedf5'],
  [0, '#fcfbfd'],
]

const getBlackPopColor = (pct: number | undefined) =>
  pct === undefined ? 'transparent' : SCALE.find(([min]) => pct >= min)![1]

export function BlackPopLegend() {
  return (
    <div className="legend">
      <strong>% Black / African American</strong>
      {SCALE.map(([min, color], i) => (
        <div key={min}>
          <span style={{ background: color }} />
          {i === 0 ? `≥ ${min}%` : i === SCALE.length - 1 ? `< ${SCALE[i - 1][0]}%` : `${min}–${SCALE[i - 1][0]}%`}
        </div>
      ))}
      <small>County level · ACS 5-year via Census Reporter</small>
    </div>
  )
}

export default function BlackPopLayer() {
  const [state, setState] = useState<{ shapes: FeatureCollection; pop: BlackPop } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadCounties(), import('./data/blackpop.json'), import('./data/ct_regions.json')]).then(
      ([counties, pop, ct]) => {
        if (cancelled) return
        // ACS keys Connecticut by planning region, so swap out the old CT counties
        const features = [
          ...counties.features.filter((f) => !String(f.id).startsWith('09')),
          ...(ct.default as unknown as FeatureCollection).features,
        ]
        setState({ shapes: { type: 'FeatureCollection', features }, pop: pop.default as BlackPop })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (!state) return null
  const { shapes, pop } = state
  const rowOf = (f?: { id?: string | number }) => pop[String(f?.id)]

  return (
    <Pane name="blackpop" style={{ zIndex: 380 }}>
      <GeoJSON
        data={shapes}
        style={(f) => ({
          fillColor: getBlackPopColor(rowOf(f)?.pct),
          fillOpacity: 0.65,
          color: '#0b0d14',
          weight: 0.3,
        })}
        onEachFeature={(f: { id?: string | number }, layer: Layer) => {
          const row = rowOf(f)
          layer.bindTooltip(
            `<strong>${row?.name ?? 'Unknown county'}</strong><br>Black / AA: ${row ? `${row.pct.toFixed(1)}%` : 'N/A'}`,
            { sticky: true },
          )
        }}
        pane="blackpop"
      />
    </Pane>
  )
}
