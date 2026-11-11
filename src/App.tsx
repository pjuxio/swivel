import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { GROUPS, LAYERS, fetchAmenities, geocode, reverseGeocode, type Amenity, type AmenityResults, type AmenityType } from './amenities'
import './App.css'
import AmenityMarkers, { type Selection } from './AmenityMarkers'
import ChoroplethLayer, { ChoroplethLegend } from './ChoroplethLayer'
import { CHOROPLETHS } from './choropleths'
import { fmtCount, fmtDist } from './format'

type Pos = { lat: number; lon: number }
type Query = { pos: Pos; radius: number; types: AmenityType[] }
const DEFAULT_POS: Pos = { lat: 40.7128, lon: -74.006 }
const RADII = [1000, 3000, 5000, 10000, 25000, 100000]
const layerOf = (t: AmenityType) => LAYERS.find((l) => l.type === t)!

function FlyTo({ pos, zoom }: { pos: Pos; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([pos.lat, pos.lon], zoom)
  }, [map, pos, zoom])
  return null
}

function ClickToSet({ onPick }: { onPick: (p: Pos) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }) })
  return null
}

function Info({ text }: { text: string }) {
  return (
    <span className="info" tabIndex={0} role="img" aria-label={`Source: ${text}`} data-tip={`Source: ${text}`}>
      ⓘ
    </span>
  )
}

function LayerCount({ count }: { count?: { shown: number; total: number } }) {
  if (!count) return <small>(0)</small>
  if (count.shown >= count.total) return <small>({fmtCount(count.total)})</small>
  return (
    <small className="truncated" title={`Showing the nearest ${fmtCount(count.shown)} of ${fmtCount(count.total)}`}>
      ({fmtCount(count.shown)} of {fmtCount(count.total)})
    </small>
  )
}

export default function App() {
  const [pos, setPos] = useState<Pos>(DEFAULT_POS)
  const [located, setLocated] = useState(false)
  const [placed, setPlaced] = useState(false)
  const [place, setPlace] = useState<{ key: string; name: string } | null>(null)
  const [radius, setRadius] = useState(5000)
  const [enabled, setEnabled] = useState<AmenityType[]>([])
  const [results, setResults] = useState<AmenityResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState<Query | null>(null)
  const [selected, setSelected] = useState<Selection>(null)
  const [address, setAddress] = useState('')
  const [legendOpen, setLegendOpen] = useState(true)
  const [choropleth, setChoropleth] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const searchCtrl = useRef<AbortController | null>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())

  const data: Amenity[] = useMemo(() => results?.amenities ?? [], [results])

  const pick = (p: Pos, fromDevice = false) => {
    setPos(p)
    setLocated(fromDevice)
    setPlaced(true)
  }

  const findAddress = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = address.trim()
    if (!q) return
    setFinding(true)
    setError(null)
    try {
      const hit = await geocode(q)
      if (!hit) return setError(`Couldn't find "${q}". Try a city, ZIP code or full address.`)
      pick(hit)
    } catch (err) {
      setError(`Could not look up that location: ${(err as Error).message}`)
    } finally {
      setFinding(false)
    }
  }

  // Location is only requested when the user asks for it
  const locate = () => {
    if (!navigator.geolocation) return setError('Geolocation is not supported by this browser.')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        pick({ lat: p.coords.latitude, lon: p.coords.longitude }, true)
        setError(null)
      },
      () => setError('Could not get your location. Click the map or enter an address instead.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // Reverse-geocode the chosen point for the heading
  const posKey = `${pos.lat},${pos.lon}`
  useEffect(() => {
    if (!placed) return
    const ctrl = new AbortController()
    reverseGeocode(pos.lat, pos.lon, ctrl.signal).then(
      (name) => setPlace({ key: posKey, name }),
      () => {
        if (!ctrl.signal.aborted) setPlace({ key: posKey, name: 'Selected location' })
      },
    )
    return () => ctrl.abort()
  }, [pos, posKey, placed])
  const placeName = place?.key === posKey ? place.name : null

  const search = () => {
    searchCtrl.current?.abort()
    const ctrl = new AbortController()
    searchCtrl.current = ctrl
    const q: Query = { pos, radius, types: enabled }
    setQuery(q)
    setLoading(true)
    setError(null)
    setSelected(null)
    fetchAmenities(q.pos.lat, q.pos.lon, q.radius, q.types, ctrl.signal)
      .then((r) => {
        if (ctrl.signal.aborted) return
        setResults(r)
        const failed = Object.keys(r.errors) as AmenityType[]
        if (failed.length) setError(`Could not load: ${failed.map((t) => layerOf(t).label).join(', ')}.`)
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted) return
        setResults(null)
        setError(`Could not load amenities: ${e.message}`)
      })
      .finally(() => {
        if (searchCtrl.current === ctrl) {
          searchCtrl.current = null
          setLoading(false)
        }
      })
  }

  useEffect(() => () => searchCtrl.current?.abort(), [])

  const reset = () => {
    searchCtrl.current?.abort()
    searchCtrl.current = null
    setLoading(false)
    setChoropleth(null)
    setEnabled([])
    setQuery(null)
    setResults(null)
    setSelected(null)
    setError(null)
  }

  // A marker picked on the map: bring its row into view
  useEffect(() => {
    if (selected?.from === 'map') rows.current.get(selected.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  const selectFromMap = useCallback((id: string) => setSelected({ id, from: 'map' }), [])
  const onLayerError = useCallback((message: string) => {
    setError(message)
    setChoropleth(null)
  }, [])

  const truncated = useMemo(
    () =>
      query?.types.flatMap((t) => {
        const c = results?.counts[t]
        return c && c.shown < c.total ? [{ type: t, ...c }] : []
      }) ?? [],
    [query, results],
  )

  const zoom = radius <= 1000 ? 15 : radius <= 3000 ? 13 : radius <= 5000 ? 12 : radius <= 10000 ? 11 : radius <= 25000 ? 10 : 8
  const origin = query?.pos ?? pos
  const activeChoropleth = CHOROPLETHS.find((c) => c.id === choropleth)

  const toggle = (t: AmenityType) =>
    setEnabled((e) => (e.includes(t) ? e.filter((x) => x !== t) : [...e, t]))

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-body">
        <p className="brand">SWIVEL</p>
        <h1>Know what's around you. 👀</h1>
        {placed && (
          <p className="where">
            📍 <strong>{placeName ?? 'Locating…'}</strong>
            <br />
            <small>{pos.lat.toFixed(4)}, {pos.lon.toFixed(4)}</small>
          </p>
        )}
        <p className="sos">Maintain situational awareness. In an emergency call 911.</p>

        <button onClick={locate}>📍 Use my location</button>
        <form className="lookup" onSubmit={findAddress}>
          <input
            type="search"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Enter an address, city or ZIP"
            aria-label="Location"
          />
          <button type="submit" disabled={!address.trim() || finding}>{finding ? '…' : 'Go'}</button>
        </form>
        <p className="hint">
          {located ? 'Using your location.' : placed ? 'Click the map to move the point.' : 'Use your location, enter an address, or click the map.'}
        </p>

        <label className="field">
          Radius
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {RADII.map((r) => (
              <option key={r} value={r}>{fmtDist(r)}</option>
            ))}
          </select>
        </label>

        {GROUPS.map((g) => {
          const amenities = LAYERS.filter((l) => l.group === g.id)
          const shading = CHOROPLETHS.filter((c) => c.group === g.id)
          const active = amenities.filter((l) => enabled.includes(l.type)).length + shading.filter((c) => c.id === choropleth).length
          return (
            <details key={g.id} className="layers">
              <summary className="group">
                <span className="grp-label">{g.label}</span>
                {active > 0 && <span className="badge">{active}</span>}
              </summary>
              {amenities.map((l) => (
                <label key={l.type} className="layer">
                  <input type="checkbox" checked={enabled.includes(l.type)} onChange={() => toggle(l.type)} />
                  <span className="dot" style={{ background: l.color }} />
                  {l.emoji} <span>{l.label}</span> {query?.types.includes(l.type) && results && <LayerCount count={results.counts[l.type]} />}
                  <Info text={l.source} />
                </label>
              ))}
              {shading.map((c) => (
                <label key={c.id} className="layer">
                  <input type="checkbox" data-layer={c.id} checked={choropleth === c.id} onChange={(e) => setChoropleth(e.target.checked ? c.id : null)} />
                  {c.emoji} <span>{c.label}</span> <Info text={`${c.source} · county map shading`} />
                </label>
              ))}
            </details>
          )
        })}

        <div role="status" aria-live="polite">
          {loading && (
            <div className="status">
              <span className="spinner" /> Searching nearby…
            </div>
          )}
          {!loading && results && query && (
            <span className="sr-only">{`${fmtCount(data.length)} result${data.length === 1 ? '' : 's'} found.`}</span>
          )}
        </div>
        <div role="alert">{error && <p className="error">{error}</p>}</div>

        {!loading && truncated.length > 0 && (
          <p className="notice">
            Only the nearest results are shown for{' '}
            {truncated.map((t, i) => (
              <span key={t.type}>
                {i > 0 && (i === truncated.length - 1 ? ' and ' : ', ')}
                {layerOf(t.type).label} ({fmtCount(t.shown)} of {fmtCount(t.total)})
              </span>
            ))}
            . Use a smaller radius to see everything.
          </p>
        )}

        <ul className="results" aria-label="Results">
          {data.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                ref={(el) => {
                  if (el) rows.current.set(a.id, el)
                  else rows.current.delete(a.id)
                }}
                className={a.id === selected?.id ? 'active' : ''}
                aria-current={a.id === selected?.id ? 'true' : undefined}
                onClick={() => setSelected({ id: a.id, from: 'list' })}
              >
                <strong>{layerOf(a.type).emoji} {a.name}</strong>
                <span>{fmtDist(a.distance)}</span>
              </button>
            </li>
          ))}
          {!loading && query && results && !error && !data.length && <li className="empty">No results in this area.</li>}
        </ul>
        <p className="hint">
          Map © OpenStreetMap contributors. Place names by Nominatim. Listings come from public datasets that may be out of
          date; verify before relying on them.
        </p>
        </div>

        <div className="sidebar-actions">
          {!enabled.length && <p className="hint">Select what you're looking for, then press Search.</p>}
          <div className="action-row">
            <button className="primary" disabled={!enabled.length || loading} onClick={search}>
              🔍 Search
            </button>
            <button onClick={reset}>↺ Reset</button>
          </div>
        </div>
      </aside>

      <div className="map-wrap">
      <MapContainer center={[pos.lat, pos.lon]} zoom={zoom} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {activeChoropleth && <ChoroplethLayer key={activeChoropleth.id} cfg={activeChoropleth} onError={onLayerError} />}
        <FlyTo pos={pos} zoom={zoom} />
        <ClickToSet onPick={(p) => pick(p)} />
        <Circle center={[pos.lat, pos.lon]} radius={radius} pathOptions={{ color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.1, weight: 2, dashArray: '6 8' }} />
        <CircleMarker center={[pos.lat, pos.lon]} radius={16} pathOptions={{ stroke: false, fillColor: '#22d3ee', fillOpacity: 0.25 }} />
        <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{ color: '#fff', fillColor: '#22d3ee', fillOpacity: 1, weight: 3 }} />
        <AmenityMarkers items={data} origin={origin} selected={selected} onSelect={selectFromMap} />
      </MapContainer>
      {activeChoropleth && (
        <div className="map-legend">
          <button
            type="button"
            className="legend-toggle"
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((o) => !o)}
          >
            <span>Legend</span>
            <span className="legend-caret" aria-hidden="true" />
          </button>
          {legendOpen && <ChoroplethLegend cfg={activeChoropleth} />}
        </div>
      )}
      </div>
    </div>
  )
}
