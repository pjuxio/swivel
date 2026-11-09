import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { GROUPS, type LayerGroup, LAYERS, distanceMeters, fetchAmenities, geocode, reverseGeocode, type Amenity, type AmenityType } from './amenities'
import './App.css'
import BlackPopLayer, { BlackPopLegend } from './BlackPopLayer'
import PresidentialLayer, { PresidentialLegend, type PresYear } from './PresidentialLayer'
import ViolentCrimeLayer, { ViolentCrimeLegend } from './ViolentCrimeLayer'
import ChoroplethLayer, { ChoroplethLegend } from './ChoroplethLayer'
import { CHOROPLETHS } from './choropleths'

type Pos = { lat: number; lon: number }
const DEFAULT_POS: Pos = { lat: 40.7128, lon: -74.006 }
const RADII = [1000, 3000, 5000, 10000, 25000, 100000]
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

const PRES_YEARS: PresYear[] = [2016, 2020, 2024]

const COUNTY_LAYERS: { id: string; group: LayerGroup; emoji: string; label: string; source: string }[] = [
  { id: 'pres2024', group: 'social', emoji: '🗳️', label: '2024 presidential results', source: 'County level' },
  { id: 'pres2020', group: 'social', emoji: '🗳️', label: '2020 presidential results', source: 'County level' },
  { id: 'pres2016', group: 'social', emoji: '🗳️', label: '2016 presidential results', source: 'County level' },
  { id: 'blackpop', group: 'demographics', emoji: '🟪', label: 'Black / African American population', source: 'Census ACS 2020–24' },
  ...CHOROPLETHS.map((c) => ({
    id: c.id,
    group: ({
      hispanic: 'demographics', asian: 'demographics', aian: 'demographics', foreign: 'demographics',
      poverty: 'demographics', income: 'demographics', broadband: 'demographics', life: 'demographics',
      mobile_g4: 'social', mobile_g5: 'social', pres_shift: 'social', hatecrime: 'social', ej: 'environmental', lead: 'environmental', pfas: 'environmental', aqi: 'environmental',
    } as Record<string, LayerGroup>)[c.id],
    emoji: c.emoji,
    label: c.label,
    source: c.source,
  })),
  { id: 'violentcrime', group: 'public_safety', emoji: '🚨', label: 'Violent crime rate', source: 'CHR 2022 · older data' },
]

function Info({ text }: { text: string }) {
  return (
    <span className="info" tabIndex={0} role="img" aria-label={`Source: ${text}`} data-tip={`Source: ${text}`}>
      ⓘ
    </span>
  )
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
  const [address, setAddress] = useState('')
  const [choropleth, setChoropleth] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)

  const findAddress = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = address.trim()
    if (!q) return
    setFinding(true)
    setError(null)
    try {
      const hit = await geocode(q)
      if (!hit) return setError(`Couldn't find "${q}". Try a city, ZIP code or full address.`)
      setPos(hit)
      setLocated(false)
      setPlaced(true)
    } catch (err) {
      setError(`Could not look up that location: ${(err as Error).message}`)
    } finally {
      setFinding(false)
    }
  }

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
      .then(({ amenities, errors }) => {
        setData(amenities)
        const failed = Object.keys(errors) as AmenityType[]
        if (failed.length) setError(`Could not load: ${failed.map((t) => layerOf(t).label).join(', ')}.`)
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
  const zoom = radius <= 1000 ? 15 : radius <= 3000 ? 13 : radius <= 5000 ? 12 : radius <= 10000 ? 11 : radius <= 25000 ? 10 : 8

  const reset = () => {
    setAddress('')
    setChoropleth(null)
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
        <p className="hint">{located ? 'Using your location.' : 'Or click the map to set a location.'}</p>

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
          const shading = COUNTY_LAYERS.filter((c) => c.group === g.id)
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
                  {l.emoji} <span>{l.label}</span> {query?.types.includes(l.type) && !loading && <small>({counts[l.type] ?? 0})</small>}
                  <Info text={l.source ?? 'OpenStreetMap'} />
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

        {choropleth === 'blackpop' && <BlackPopLegend />}
        {PRES_YEARS.filter((y) => choropleth === `pres${y}`).map((y) => <PresidentialLegend key={y} year={y} />)}
        {choropleth === 'violentcrime' && <ViolentCrimeLegend />}
        {CHOROPLETHS.filter((c) => c.id === choropleth).map((c) => <ChoroplethLegend key={c.id} cfg={c} />)}


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
        </div>

        <div className="sidebar-actions">
          {!enabled.length && <p className="hint">Select what you're looking for, then press Search.</p>}
          <div className="action-row">
            <button
              className="primary"
              disabled={!enabled.length || loading}
              onClick={() => setQuery({ pos, radius, types: enabled })}
            >
              🔍 Search
            </button>
            <button onClick={reset}>↺ Reset</button>
          </div>
        </div>
      </aside>

      <MapContainer center={[pos.lat, pos.lon]} zoom={zoom} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {choropleth === 'blackpop' && <BlackPopLayer />}
        {PRES_YEARS.filter((y) => choropleth === `pres${y}`).map((y) => <PresidentialLayer key={y} year={y} />)}
        {choropleth === 'violentcrime' && <ViolentCrimeLayer />}
        {CHOROPLETHS.filter((c) => c.id === choropleth).map((c) => <ChoroplethLayer key={c.id} cfg={c} />)}
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
