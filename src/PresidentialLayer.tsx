import { useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { Layer } from 'leaflet'
import { GeoJSON, Pane } from 'react-leaflet'
import { loadAcsShapes, loadCounties } from './countyShapes'

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

export type PresYear = 2016 | 2020 | 2024

const DEM: Record<PresYear, string> = { 2016: 'Clinton', 2020: 'Biden', 2024: 'Harris' }

const loaders: Record<PresYear, () => Promise<{ default: unknown }>> = {
  2016: () => import('./data/pres2016.json'),
  2020: () => import('./data/pres2020.json'),
  2024: () => import('./data/pres2024.json'),
}

const colorOf = (margin: number | undefined) =>
  margin === undefined ? 'transparent' : SCALE.find(([min]) => margin >= min)![1]

export function PresidentialLegend({ year }: { year: PresYear }) {
  return (
    <div className="legend">
      <strong>{year} presidential result</strong>
      {SCALE.map(([, color, label]) => (
        <div key={label}>
          <span style={{ background: color }} />
          {label}
        </div>
      ))}
      <small>County level · margin of victory{year === 2024 ? ' · Connecticut by planning region' : ''}</small>
    </div>
  )
}

const fmt = (n: number) => n.toLocaleString('en-US')

export default function PresidentialLayer({ year }: { year: PresYear }) {
  const [state, setState] = useState<{ shapes: FeatureCollection; results: Results } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([year === 2024 ? loadAcsShapes() : loadCounties(), loaders[year]()]).then(([shapes, results]) => {
      if (!cancelled) setState({ shapes, results: results.default as Results })
    })
    return () => {
      cancelled = true
    }
  }, [year])

  if (!state) return null
  const { shapes, results } = state
  const rowOf = (f?: { id?: string | number }) => results[String(f?.id)]

  return (
    <Pane name={`pres${year}`} style={{ zIndex: 380 }}>
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
              ? `<strong>${r.name}</strong><br>${r.margin >= 0 ? 'Trump (R)' : `${DEM[year]} (D)`} +${Math.abs(r.margin).toFixed(1)}<br>` +
                  `Trump ${fmt(r.gop)} · ${DEM[year]} ${fmt(r.dem)}`
              : '<strong>No data</strong>',
            { sticky: true },
          )
        }}
        pane={`pres${year}`}
      />
    </Pane>
  )
}
