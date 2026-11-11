import { useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { Layer } from 'leaflet'
import { GeoJSON, Pane } from 'react-leaflet'
import { loadAcsShapes, loadCounties } from './countyShapes'
import { colorOf, type ChoroplethConfig, type Row } from './choropleths'

export function ChoroplethLegend({ cfg }: { cfg: ChoroplethConfig }) {
  const { scale, format, labels } = cfg
  const text = (i: number) => {
    if (labels) return labels[i]
    const [min] = scale[i]
    if (i === scale.length - 1) return `≥ ${format(min)}`
    if (i === 0) return `< ${format(scale[1][0])}`
    return `${format(min)} – ${format(scale[i + 1][0])}`
  }
  return (
    <div className="legend">
      <strong>{cfg.legendTitle}</strong>
      {scale
        .map(([min, color], i) => (
          <div key={min}>
            <span style={{ background: color }} />
            {text(i)}
          </div>
        ))
        .reverse()}
      <small>{cfg.note}</small>
    </div>
  )
}

export default function ChoroplethLayer({ cfg, onError }: { cfg: ChoroplethConfig; onError: (message: string) => void }) {
  const [state, setState] = useState<{ shapes: FeatureCollection; rows: Record<string, Row> } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([cfg.shapes === 'acs' ? loadAcsShapes() : loadCounties(), cfg.load()]).then(
      ([shapes, rows]) => {
        if (!cancelled) setState({ shapes, rows })
      },
      () => {
        // Usually a stale tab asking for a chunk that a newer deploy replaced
        if (!cancelled) onError(`Could not load "${cfg.label}". Reload the page and try again.`)
      },
    )
    return () => {
      cancelled = true
    }
  }, [cfg, onError])

  if (!state) return null
  const { shapes, rows } = state
  const rowOf = (f?: { id?: string | number }) => rows[String(f?.id)]
  const pane = `choropleth-${cfg.id}`
  const describe = cfg.describe ?? ((v: number) => `${cfg.label}: ${cfg.format(v)}`)

  return (
    <Pane name={pane} style={{ zIndex: 380 }}>
      <GeoJSON
        data={shapes}
        style={(f) => ({ fillColor: colorOf(cfg, rowOf(f)?.value), fillOpacity: 0.65, color: '#0b0d14', weight: 0.3 })}
        onEachFeature={(f: { id?: string | number }, layer: Layer) => {
          const r = rowOf(f)
          layer.bindTooltip(
            r
              ? `<strong>${r.name}</strong><br>${r.value == null ? `${cfg.label}: N/A` : describe(r.value)}${r.extra ? `<br><small>${r.extra}</small>` : ''}`
              : '<strong>No data</strong>',
            { sticky: true },
          )
        }}
        pane={pane}
      />
    </Pane>
  )
}
