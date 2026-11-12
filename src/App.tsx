import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { GROUPS, LAYERS, fetchAmenities, geocode, reverseGeocode, type Amenity, type AmenityResults, type AmenityType } from './amenities'
import './App.css'
import AmenityMarkers, { type Selection } from './AmenityMarkers'
import ChoroplethLayer, { ChoroplethLegend } from './ChoroplethLayer'
import { CHOROPLETHS } from './choropleths'
import { downloadCsv } from './exportCsv'
import { fmtCount, fmtDist } from './format'
import Landing from './Landing'
import SupportLink from './SupportLink'
import WeatherAlerts, { WeatherAlertShapes, useWeatherAlerts } from './WeatherAlerts'
import AboutLink from './AboutLink'

type Pos = { lat: number; lon: number }
type Query = { pos: Pos; radius: number; types: AmenityType[] }
const DEFAULT_POS: Pos = { lat: 40.7128, lon: -74.006 }
const RADII = [1000, 3000, 5000, 10000, 25000, 100000]
const layerOf = (t: AmenityType) => LAYERS.find((l) => l.type === t)!

const SPOT_KEY = 'swivel:spot'
type Spot = Pos & { located: boolean }
// Per-tab, so a refresh returns to the same point on the map but a fresh visit sees the landing page
const readSpot = (): Spot | null => {
  try {
    const s = JSON.parse(sessionStorage.getItem(SPOT_KEY) ?? 'null')
    return Number.isFinite(s?.lat) && Number.isFinite(s?.lon) ? { lat: s.lat, lon: s.lon, located: !!s.located } : null
  } catch {
    return null
  }
}
const writeSpot = (spot: Spot | null) => {
  try {
    if (spot) sessionStorage.setItem(SPOT_KEY, JSON.stringify(spot))
    else sessionStorage.removeItem(SPOT_KEY)
  } catch {
    // Storage can be blocked; the app still works, it just shows the landing page again on refresh
  }
}

function FlyTo({ pos, zoom }: { pos: Pos; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([pos.lat, pos.lon], zoom)
  }, [map, pos, zoom])
  return null
}

function DoubleClickToSet({ onPick, onTap }: { onPick: (p: Pos) => void; onTap: () => void }) {
  useMapEvents({ dblclick: (e) => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }), click: onTap })
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
  const [saved] = useState(readSpot)
  const [started, setStarted] = useState(saved !== null)
  const [pos, setPos] = useState<Pos>(saved ? { lat: saved.lat, lon: saved.lon } : DEFAULT_POS)
  const [located, setLocated] = useState(saved?.located ?? false)
  const [placed, setPlaced] = useState(saved !== null)
  const [locating, setLocating] = useState(false)
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
  const weather = useWeatherAlerts(pos.lat, pos.lon, radius, started && placed)
  const searchCtrl = useRef<AbortController | null>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())

  // Mobile bottom sheet: scrolling the panel raises it over the map; searching or picking a result lowers it.
  // Driven by wheel/touch rather than scroll events, because selecting a marker scrolls the list programmatically.
  const [sheetOpen, setSheetOpen] = useState(false)
  const touchY = useRef<number | null>(null)
  const lowerSheet = useCallback(() => setSheetOpen(false), [])
  const onSheetWheel = (e: React.WheelEvent) => {
    if (e.deltaY > 0) setSheetOpen(true)
  }
  const onSheetTouchStart = (e: React.TouchEvent) => {
    touchY.current = e.touches[0]?.clientY ?? null
  }
  const onSheetTouchMove = (e: React.TouchEvent) => {
    const y = e.touches[0]?.clientY
    if (touchY.current !== null && y !== undefined && touchY.current - y > 10) setSheetOpen(true)
  }

  const data: Amenity[] = useMemo(() => results?.amenities ?? [], [results])

  const pick = (p: Pos, fromDevice = false) => {
    setPos(p)
    setLocated(fromDevice)
    setPlaced(true)
  }

  // Remember the current point for this tab once the map is open
  useEffect(() => {
    if (started) writeSpot({ lat: pos.lat, lon: pos.lon, located })
  }, [started, pos, located])

  const enterMap = (p: Pos, fromDevice = false) => {
    pick(p, fromDevice)
    setError(null)
    setStarted(true)
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
      enterMap(hit)
    } catch (err) {
      setError(`Could not look up that location: ${(err as Error).message}`)
    } finally {
      setFinding(false)
    }
  }

  // Location is only requested when the user asks for it; the landing page stays up until it resolves
  const locate = () => {
    if (!navigator.geolocation) return setError('Geolocation is not supported by this browser. Enter an address instead.')
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        enterMap({ lat: p.coords.latitude, lon: p.coords.longitude }, true)
      },
      () => {
        setLocating(false)
        setError('Could not get your location. Enter an address instead.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const changeLocation = () => {
    reset()
    writeSpot(null)
    setStarted(false)
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

  if (!started) {
    return (
      <Landing
        address={address}
        finding={finding}
        locating={locating}
        error={error}
        onAddressChange={setAddress}
        onSubmitAddress={findAddress}
        onUseLocation={locate}
      />
    )
  }

  return (
    <div className="app">
      <aside className={sheetOpen ? 'sidebar sheet-open' : 'sidebar'}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={sheetOpen ? 'Show the map' : 'Expand the panel'}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}
        />
        <div className="sidebar-body" onWheel={onSheetWheel} onTouchStart={onSheetTouchStart} onTouchMove={onSheetTouchMove}>
        <h1 className="brand">SWIVEL</h1>
        <p className="sos">
          Always maintain situational awareness.
          <br />
          In an emergency call 911.
        </p>
        {placed && (
          <div className="where">
            <p>
              📍 <strong>{placeName ?? 'Locating…'}</strong>
              <br />
              <small>{pos.lat.toFixed(4)}, {pos.lon.toFixed(4)}</small>
            </p>
            <button type="button" className="icon-button" onClick={changeLocation} aria-label="Change location" title="Change location">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        <p className="hint">{located ? 'Using your location. Double click the map to move the point.' : 'Double click the map to move the point.'}</p>

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
          if (!amenities.length) return null
          const active = amenities.filter((l) => enabled.includes(l.type)).length
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
            </details>
          )
        })}

        {/* County shading layers, sub-grouped by topic; only one can be shown at a time */}
        <details className="layers">
          <summary className="group">
            <span className="grp-label">Map Layers</span>
            {activeChoropleth && <span className="badge">1</span>}
          </summary>
          {GROUPS.map((g) => {
            const shading = CHOROPLETHS.filter((c) => c.group === g.id)
            if (!shading.length) return null
            return (
              <div key={g.id} className="layer-subgroup" role="group" aria-labelledby={`maplayers-${g.id}`}>
                <p className="layer-subhead" id={`maplayers-${g.id}`}>{g.label}</p>
                {shading.map((c) => (
                  <label key={c.id} className="layer">
                    <input type="checkbox" data-layer={c.id} checked={choropleth === c.id} onChange={(e) => setChoropleth(e.target.checked ? c.id : null)} />
                    {c.emoji} <span>{c.label}</span> <Info text={`${c.source} · county map shading`} />
                  </label>
                ))}
              </div>
            )
          })}
        </details>

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

        {!loading && data.length > 0 && (
          <div className="export-row">
            <button type="button" className="footer-link" onClick={() => downloadCsv(data)}>
              ⬇ Export {fmtCount(data.length)} listing{data.length === 1 ? '' : 's'} (CSV)
            </button>
          </div>
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
                onClick={() => {
                  setSelected({ id: a.id, from: 'list' })
                  lowerSheet()
                }}
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
        <div className="footer-links">
          <SupportLink />
          <AboutLink />
        </div>
        </div>

        <div className="sidebar-actions">
          {!enabled.length && <p className="hint">Select what you're looking for, then press Search.</p>}
          <div className="action-row">
            <button
              className="primary"
              disabled={!enabled.length || loading}
              onClick={() => {
                search()
                lowerSheet()
              }}
            >
              🔍 Search
            </button>
            <button onClick={reset}>↺ Reset</button>
          </div>
        </div>
      </aside>

      <div className="map-wrap">
      {/* Double click moves the point, so it must not also zoom */}
      <MapContainer center={[pos.lat, pos.lon]} zoom={zoom} className="map" doubleClickZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {activeChoropleth && <ChoroplethLayer key={activeChoropleth.id} cfg={activeChoropleth} onError={onLayerError} />}
        {weather?.alerts && <WeatherAlertShapes alerts={weather.alerts} />}
        <FlyTo pos={pos} zoom={zoom} />
        <DoubleClickToSet onPick={(p) => pick(p)} onTap={lowerSheet} />
        <Circle center={[pos.lat, pos.lon]} radius={radius} pathOptions={{ color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.1, weight: 2, dashArray: '6 8' }} />
        <CircleMarker center={[pos.lat, pos.lon]} radius={16} pathOptions={{ stroke: false, fillColor: '#22d3ee', fillOpacity: 0.25 }} />
        <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{ color: '#fff', fillColor: '#22d3ee', fillOpacity: 1, weight: 3 }} />
        <AmenityMarkers items={data} origin={origin} selected={selected} onSelect={selectFromMap} />
      </MapContainer>
      {weather && <WeatherAlerts state={weather} radius={radius} />}
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
