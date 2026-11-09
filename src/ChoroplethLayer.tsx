import { useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { Layer } from 'leaflet'
import { GeoJSON, Pane } from 'react-leaflet'
import { loadAcsShapes, loadCounties } from './countyShapes'
import type { ChoroplethConfig, Row } from './choropleths'

const colorOf = (cfg: ChoroplethConfig, v: number | null | undefined) =>
  v == null ? 'transparent' : [...cfg.scale].reverse().find(([min]) => v >= min)![1]

export function ChoroplethLegend({ cfg }: { cfg: ChoroplethConfig }) {
  const { scale, format } = cfg
  return (
    <div className="legend">
      <strong>{cfg.legendTitle}</strong>
      {[...scale].reverse().map(([min, color], i, all) => (
        <div key={min}>
          <span style={{ background: color }} />
          {i === 0 ? `≥ ${format(min)}` : i === all.length - 1 ? `< ${format(all[i - 1][0])}` : `${format(min)} – ${format(all[i - 1][0])}`}
        </div>
      ))}
      <small>{cfg.note}</small>
    </div>
  )
}

export default function ChoroplethLayer({ cfg }: { cfg: ChoroplethConfig }) {
  const [state, setState] = useState<{ shapes: FeatureCollection; rows: Record<string, Row> } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([cfg.shapes === 'acs' ? loadAcsShapes() : loadCounties(), cfg.load()]).then(([shapes, rows]) => {
      if (!cancelled) setState({ shapes, rows })
    })
    return () => {
      cancelled = true
    }
  }, [cfg])

  if (!state) return null
  const { shapes, rows } = state
  const rowOf = (f?: { id?: string | number }) => rows[String(f?.id)]
  const pane = `choropleth-${cfg.id}`

  return (
    <Pane name={pane} style={{ zIndex: 380 }}>
      <GeoJSON
        data={shapes}
        style={(f) => ({ fillColor: colorOf(cfg, rowOf(f)?.value), fillOpacity: 0.65, color: '#0b0d14', weight: 0.3 })}
        onEachFeature={(f: { id?: string | number }, layer: Layer) => {
          const r = rowOf(f)
          layer.bindTooltip(
            r
              ? `<strong>${r.name}</strong><br>${cfg.label}: ${r.value == null ? 'N/A' : cfg.format(r.value)}${r.extra ? `<br><small>${r.extra}</small>` : ''}`
              : '<strong>No data</strong>',
            { sticky: true },
          )
        }}
        pane={pane}
      />
    </Pane>
  )
}
