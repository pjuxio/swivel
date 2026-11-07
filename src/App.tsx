import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { LAYERS, distanceMeters, fetchAmenities, reverseGeocode, type Amenity, type AmenityType } from './amenities'
import './App.css'

type Pos = { lat: number; lon: number }
const DEFAULT_POS: Pos = { lat: 40.7128, lon: -74.006 }
const RADII = [1000, 3000, 5000, 10000, 25000]
const layerOf = (t: AmenityType) => LAYERS.find((l) => l.type === t)!

const ICONS = Object.fromEntries(
  LAYERS.map((l) => [
    l.type,
    L.divIcon({
      className: '',
      html: `<div class="pin" style="background:${l.color}">${l.emoji}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -15],
    }),
  ]),
) as Record<AmenityType, L.DivIcon>

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

function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

export default function App() {
  const [pos, setPos] = useState<Pos>(DEFAULT_POS)
  const [located, setLocated] = useState(false)
  const [placed, setPlaced] = useState(false)
  const [placeName, setPlaceName] = useState<string | null>(null)
  const [radius, setRadius] = useState(5000)
  const [enabled, setEnabled] = useState<AmenityType[]>([])
  const [data, setData] = useState<Amenity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState<{ pos: Pos; radius: number; types: AmenityType[] } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const locate = () => {
    if (!navigator.geolocation) return setError('Geolocation is not supported by this browser.')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude })
        setLocated(true)
        setPlaced(true)
        setError(null)
      },
      () => setError('Could not get your location. Click the map to set it manually.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  useEffect(locate, [])

  // Reverse-geocode the chosen point for the heading
  useEffect(() => {
    if (!placed) return
    const ctrl = new AbortController()
    setPlaceName(null)
    reverseGeocode(pos.lat, pos.lon, ctrl.signal).then(setPlaceName, () => {})
    return () => ctrl.abort()
  }, [pos, placed])

  // Searches run only when the user presses the Search button
  useEffect(() => {
    if (!query) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setSelected(null)
    fetchAmenities(query.pos.lat, query.pos.lon, query.radius, query.types, ctrl.signal)
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return
        setData([])
        setError(`Could not load amenities: ${e.message}`)
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [query])

  const origin = query?.pos ?? pos
  const counts = useMemo(() => {
    const c: Partial<Record<AmenityType, number>> = {}
    data.forEach((a) => (c[a.type] = (c[a.type] ?? 0) + 1))
    return c
  }, [data])
  const zoom = radius <= 1000 ? 15 : radius <= 3000 ? 13 : radius <= 5000 ? 12 : radius <= 10000 ? 11 : 10

  const reset = () => {
    setPos(DEFAULT_POS)
    setLocated(false)
    setPlaced(false)
    setPlaceName(null)
    setRadius(5000)
    setEnabled([])
    setQuery(null)
    setData([])
    setSelected(null)
    setError(null)
  }

  const toggle = (t: AmenityType) =>
    setEnabled((e) => (e.includes(t) ? e.filter((x) => x !== t) : [...e, t]))

  return (
    <div className="app">
      <aside className="sidebar">
        <p className="brand">SWIVEL</p>
        <h1>Know what's around you.</h1>
        {placed && (
          <p className="where">
            📍 <strong>{placeName ?? 'Locating…'}</strong>
            <br />
            <small>{pos.lat.toFixed(4)}, {pos.lon.toFixed(4)}</small>
          </p>
        )}
        <p className="sos">Maintain situational awareness. In an emergency call 911.</p>

        <button onClick={locate}>📍 Use my location</button>
        <p className="hint">{located ? 'Using your location.' : 'Or click the map to set a location.'}</p>

        <label className="field">
          Radius
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {RADII.map((r) => (
              <option key={r} value={r}>{fmtDist(r)}</option>
            ))}
          </select>
        </label>

        <div className="layers">
          {LAYERS.map((l) => (
            <label key={l.type} className="layer">
              <input type="checkbox" checked={enabled.includes(l.type)} onChange={() => toggle(l.type)} />
              <span className="dot" style={{ background: l.color }} />
              {l.emoji} <span>{l.label}</span> <small className="source">{l.source ?? 'OpenStreetMap'}</small> {query?.types.includes(l.type) && !loading && <small>({counts[l.type] ?? 0})</small>}
            </label>
          ))}
        </div>

        <button
          className="primary"
          disabled={!enabled.length || loading}
          onClick={() => setQuery({ pos, radius, types: enabled })}
        >
          🔍 Search
        </button>
        <button onClick={reset}>↺ Reset</button>
        {!enabled.length && <p className="hint">Select what you're looking for, then press Search.</p>}

        {loading && (
          <div className="status" role="status" aria-live="polite">
            <span className="spinner" /> Searching nearby…
          </div>
        )}
        {error && <p className="error">{error}</p>}

        <ul className="results">
          {data.map((a) => (
            <li key={a.id} className={a.id === selected ? 'active' : ''} onClick={() => setSelected(a.id)}>
              <strong>{layerOf(a.type).emoji} {a.name}</strong>
              <span>{fmtDist(distanceMeters(origin.lat, origin.lon, a.lat, a.lon))}</span>
            </li>
          ))}
          {!loading && query && !error && !data.length && <li className="empty">No results in this area.</li>}
        </ul>
        <p className="hint">Map © OpenStreetMap contributors. Listings come from federal datasets that may be out of date; verify before relying on them.</p>
      </aside>

      <MapContainer center={[pos.lat, pos.lon]} zoom={zoom} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FlyTo pos={pos} zoom={zoom} />
        <ClickToSet onPick={(p) => { setPos(p); setLocated(false); setPlaced(true) }} />
        <Circle center={[pos.lat, pos.lon]} radius={radius} pathOptions={{ color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.1, weight: 2, dashArray: '6 8' }} />
        <CircleMarker center={[pos.lat, pos.lon]} radius={16} pathOptions={{ stroke: false, fillColor: '#22d3ee', fillOpacity: 0.25 }} />
        <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{ color: '#fff', fillColor: '#22d3ee', fillOpacity: 1, weight: 3 }} />
        {data.map((a) => (
          <Marker
            key={a.id}
            position={[a.lat, a.lon]}
            icon={ICONS[a.type]}
            eventHandlers={{ click: () => setSelected(a.id) }}
          >
            <Popup>
              <strong>{a.name}</strong>
              <br />
              {layerOf(a.type).label} · {fmtDist(distanceMeters(origin.lat, origin.lon, a.lat, a.lon))}
              {a.address && <><br />{a.address}</>}
              {a.details?.map((d) => (
                <div key={d.label}><strong>{d.label}:</strong> {d.value}</div>
              ))}
              {a.openingHours && <><br />Hours: {a.openingHours}</>}
              {a.phone && <><br /><a href={`tel:${a.phone}`}>{a.phone}</a></>}
              {a.website && /^https?:\/\//.test(a.website) && <><br /><a href={a.website} target="_blank" rel="noreferrer">Website</a></>}
              {a.links?.slice(0, 3).map((l) => (
                <div key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.title.slice(0, 60)}</a></div>
              ))}
              <br />
              <a
                href={`https://www.openstreetmap.org/directions?to=${a.lat},${a.lon}&from=${origin.lat},${origin.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                Directions
              </a>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
