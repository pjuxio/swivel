import { useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { Layer } from 'leaflet'
import { GeoJSON, Pane } from 'react-leaflet'
import { loadCounties } from './countyShapes'

type Row = { rate: number; name: string }
type Rates = Record<string, Row>

// [minimum violent crimes per 100,000 residents, color]
const SCALE: [number, string][] = [
  [600, '#800026'],
  [400, '#bd0026'],
  [250, '#e31a1c'],
  [150, '#fc4e2a'],
  [75, '#fd8d3c'],
  [0, '#fed976'],
]

const colorOf = (rate: number | undefined) =>
  rate === undefined ? 'transparent' : SCALE.find(([min]) => rate >= min)![1]

export function ViolentCrimeLegend() {
  return (
    <div className="legend">
      <strong>Violent crime per 100,000</strong>
      {SCALE.map(([min, color], i) => (
        <div key={min}>
          <span style={{ background: color }} />
          {i === 0 ? `≥ ${min}` : i === SCALE.length - 1 ? `< ${SCALE[i - 1][0]}` : `${min}–${SCALE[i - 1][0]}`}
        </div>
      ))}
      <small>
        Older data: County Health Rankings 2022 release (underlying FBI figures are from years earlier). Gaps =
        counties with no reported data.
      </small>
    </div>
  )
}

export default function ViolentCrimeLayer() {
  const [state, setState] = useState<{ shapes: FeatureCollection; rates: Rates } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadCounties(), import('./data/violentcrime.json')]).then(([shapes, rates]) => {
      if (!cancelled) setState({ shapes, rates: rates.default as Rates })
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!state) return null
  const { shapes, rates } = state
  const rowOf = (f?: { id?: string | number }) => rates[String(f?.id)]

  return (
    <Pane name="violentcrime" style={{ zIndex: 380 }}>
      <GeoJSON
        data={shapes}
        style={(f) => ({
          fillColor: colorOf(rowOf(f)?.rate),
          fillOpacity: 0.65,
          color: '#0b0d14',
          weight: 0.3,
        })}
        onEachFeature={(f: { id?: string | number }, layer: Layer) => {
          const r = rowOf(f)
          layer.bindTooltip(
            r
              ? `<strong>${r.name}</strong><br>Violent crime: ${r.rate.toLocaleString('en-US')} per 100k<br><small>Older data (CHR 2022)</small>`
              : '<strong>No data reported</strong>',
            { sticky: true },
          )
        }}
        pane="violentcrime"
      />
    </Pane>
  )
}
