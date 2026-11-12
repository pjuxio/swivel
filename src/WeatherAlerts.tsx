import { useEffect, useState } from 'react'
import { GeoJSON } from 'react-leaflet'
import { fetchAlerts, type WeatherAlert } from './amenities'
import { fmtDist } from './format'

const REFRESH_MS = 5 * 60 * 1000
const COLORS: Record<WeatherAlert['severity'], string> = {
  Extreme: '#ef4444',
  Severe: '#f97316',
  Moderate: '#fcd34d',
  Minor: '#22d3ee',
  Unknown: '#8b92a8',
}

export type AlertsState = { point: string; alerts: WeatherAlert[] | null; failed: boolean }

/**
 * Live National Weather Service alerts at a point and within `radius` meters of it, refreshed every few minutes and
 * when the tab becomes visible again. Alerts for a previous point are never returned. Nothing is requested until
 * `enabled`, so the landing page never sends a point.
 */
export function useWeatherAlerts(lat: number, lon: number, radius: number, enabled: boolean): AlertsState | null {
  const point = `${lat},${lon}`
  const [state, setState] = useState<AlertsState>({ point: '', alerts: null, failed: false })

  useEffect(() => {
    if (!enabled) return
    let ctrl = new AbortController()
    const load = () => {
      ctrl.abort()
      ctrl = new AbortController()
      const { signal } = ctrl
      fetchAlerts(lat, lon, radius, signal).then(
        (alerts) => !signal.aborted && setState({ point, alerts, failed: false }),
        () => {
          // Keep showing the last alerts for this point if a refresh fails
          if (!signal.aborted) setState((s) => ({ point, alerts: s.point === point ? s.alerts : null, failed: true }))
        },
      )
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      ctrl.abort()
    }
  }, [lat, lon, radius, point, enabled])

  return enabled && state.point === point ? state : null
}

const fmtExpires = (iso?: string) =>
  iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null

/** Outlines of the warning polygons NWS drew, colored by severity. Render inside the map. */
export function WeatherAlertShapes({ alerts }: { alerts: WeatherAlert[] }) {
  return alerts.map(
    (a) =>
      a.geometry && (
        <GeoJSON
          key={`${a.id}:${a.severity}`}
          data={a.geometry}
          interactive={false}
          style={{ color: COLORS[a.severity], weight: 3, fillColor: COLORS[a.severity], fillOpacity: 0.12 }}
        />
      ),
  )
}

/** The banner on the map: the worst alert, expandable to the full list. */
export default function WeatherAlerts({ state, radius }: { state: AlertsState; radius: number }) {
  const [open, setOpen] = useState(false)
  const alerts = state.alerts ?? []

  if (!alerts.length) {
    return (
      <div className="weather" role="status">
        <p className="weather-quiet">
          {state.failed ? 'Weather alerts unavailable right now' : `No active weather alerts within ${fmtDist(radius)}`}
        </p>
      </div>
    )
  }

  const top = alerts[0]
  const more = alerts.length - 1
  return (
    <div className="weather" role="region" aria-label="Weather alerts">
      <button
        type="button"
        className="weather-toggle"
        aria-expanded={open}
        style={{ borderLeftColor: COLORS[top.severity] }}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⚠️</span>
        <span className="weather-title">
          {top.event}
          <small>
            {!top.atPoint && ' · nearby'}
            {more > 0 && ` · +${more} more`}
          </small>
        </span>
        <span className="legend-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul className="weather-list">
          {alerts.map((a) => (
            <li key={a.id} style={{ borderLeftColor: COLORS[a.severity] }}>
              <details>
                <summary>
                  <strong>{a.event}</strong>
                  <small>
                    {a.atPoint ? 'At this location' : `Within ${fmtDist(radius)}`}
                    {' · '}
                    {a.severity !== 'Unknown' && `${a.severity} · `}
                    {a.expires ? `until ${fmtExpires(a.expires)}` : 'in effect'}
                  </small>
                </summary>
                {a.headline && <p>{a.headline}</p>}
                {a.areaDesc && <p className="weather-area">{a.areaDesc}</p>}
                {a.instruction && <p className="weather-text">{a.instruction}</p>}
                {a.description && <p className="weather-text">{a.description}</p>}
                {a.sender && <p className="weather-area">Source: {a.sender}</p>}
              </details>
            </li>
          ))}
        </ul>
      )}
      {state.failed && <p className="weather-quiet">Couldn't refresh; showing the last known alerts</p>}
    </div>
  )
}
