import { useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { Layer } from 'leaflet'
import { GeoJSON, Pane } from 'react-leaflet'
import { loadCounties } from './countyShapes'

type Row = { name: string; gop: number; dem: number; total: number; margin: number }
type Results = Record<string, Row>

// [minimum margin in points, color]; positive margin = Republican lead, negative = Democratic lead
const SCALE: [number, string, string][] = [
  [40, '#99000d', 'R +40 or more'],
  [20, '#de2d26', 'R +20 to 40'],
  [5, '#fb6a4a', 'R +5 to 20'],
  [-5, '#d9d9e8', 'Within 5 points'],
  [-20, '#6baed6', 'D +5 to 20'],
  [-40, '#2171b5', 'D +20 to 40'],
  [-Infinity, '#08306b', 'D +40 or more'],
]

const colorOf = (margin: number | undefined) =>
  margin === undefined ? 'transparent' : SCALE.find(([min]) => margin >= min)![1]

export function Pres2020Legend() {
  return (
    <div className="legend">
      <strong>2020 presidential result</strong>
      {SCALE.map(([, color, label]) => (
        <div key={label}>
          <span style={{ background: color }} />
          {label}
        </div>
      ))}
      <small>County level · margin of victory</small>
    </div>
  )
}

const fmt = (n: number) => n.toLocaleString('en-US')

export default function Pres2020Layer() {
  const [state, setState] = useState<{ shapes: FeatureCollection; results: Results } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadCounties(), import('./data/pres2020.json')]).then(([shapes, results]) => {
      if (!cancelled) setState({ shapes, results: results.default as Results })
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!state) return null
  const { shapes, results } = state
  const rowOf = (f?: { id?: string | number }) => results[String(f?.id)]

  return (
    <Pane name="pres2020" style={{ zIndex: 380 }}>
      <GeoJSON
        data={shapes}
        style={(f) => ({
          fillColor: colorOf(rowOf(f)?.margin),
          fillOpacity: 0.65,
          color: '#0b0d14',
          weight: 0.3,
        })}
        onEachFeature={(f: { id?: string | number }, layer: Layer) => {
          const r = rowOf(f)
          layer.bindTooltip(
            r
              ? `<strong>${r.name}</strong><br>${r.margin >= 0 ? 'Trump (R)' : 'Biden (D)'} +${Math.abs(r.margin).toFixed(1)}<br>` +
                  `Trump ${fmt(r.gop)} · Biden ${fmt(r.dem)}`
              : '<strong>No data</strong>',
            { sticky: true },
          )
        }}
        pane="pres2020"
      />
    </Pane>
  )
}
