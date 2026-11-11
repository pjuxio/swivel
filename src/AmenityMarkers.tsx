import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { useMap } from 'react-leaflet'
import { LAYERS, type Amenity, type AmenityType } from './amenities'
import { fmtDist } from './format'

export type Selection = { id: string; from: 'list' | 'map' } | null

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

const markerType = new WeakMap<L.Marker, AmenityType>()

// Single-type clusters take that layer's color; mixed clusters show each type's share as a pie
function clusterBackground(cluster: L.MarkerCluster) {
  const counts = new Map<AmenityType, number>()
  for (const m of cluster.getAllChildMarkers()) {
    const t = markerType.get(m)
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const parts = LAYERS.filter((l) => counts.has(l.type)).map((l) => ({ color: l.color, n: counts.get(l.type)! }))
  if (parts.length === 0) return { bg: '#8b5cf6', halo: '#8b5cf6' }
  if (parts.length === 1) return { bg: parts[0].color, halo: parts[0].color }
  const total = parts.reduce((s, p) => s + p.n, 0)
  let acc = 0
  const stops = parts.map((p) => {
    const from = (acc / total) * 100
    acc += p.n
    return `${p.color} ${from}% ${(acc / total) * 100}%`
  })
  const top = parts.reduce((a, b) => (b.n > a.n ? b : a))
  return { bg: `conic-gradient(${stops.join(', ')})`, halo: top.color }
}

function clusterIcon(cluster: L.MarkerCluster) {
  const n = cluster.getChildCount()
  const size = n < 10 ? 34 : n < 100 ? 40 : 48
  const { bg, halo } = clusterBackground(cluster)
  return L.divIcon({
    className: '',
    html: `<div class="cluster" style="width:${size}px;height:${size}px;background:${bg};--halo:${halo}40">${n}</div>`,
    iconSize: [size, size],
  })
}

// Popup content is built as DOM nodes so record text is never parsed as HTML
function popupContent(a: Amenity, origin: { lat: number; lon: number }) {
  const root = document.createElement('div')
  root.className = 'popup'
  const line = (parent: HTMLElement, tag: string, text: string, className?: string) => {
    const el = document.createElement(tag)
    el.textContent = text
    if (className) el.className = className
    parent.append(el)
    return el
  }
  const link = (parent: HTMLElement, href: string, text: string) => {
    const el = document.createElement('a')
    el.href = href
    el.textContent = text
    if (!href.startsWith('tel:')) {
      el.target = '_blank'
      el.rel = 'noreferrer'
    }
    parent.append(el)
    return el
  }
  line(root, 'strong', a.name, 'popup-title')
  line(root, 'div', `${layerOf(a.type).label} · ${fmtDist(a.distance)}`, 'popup-meta')
  if (a.address) line(root, 'div', a.address)
  for (const d of a.details ?? []) {
    const row = document.createElement('div')
    line(row, 'strong', `${d.label}: `)
    row.append(d.value)
    root.append(row)
  }
  const links = document.createElement('div')
  links.className = 'popup-links'
  if (a.phone) link(links, `tel:${a.phone}`, a.phone)
  if (a.website && /^https?:\/\//.test(a.website)) link(links, a.website, 'Website')
  for (const l of a.links?.slice(0, 3) ?? []) {
    if (/^https?:\/\//.test(l.url)) link(links, l.url, l.title.slice(0, 60))
  }
  link(links, `https://www.openstreetmap.org/directions?to=${a.lat},${a.lon}&from=${origin.lat},${origin.lon}`, 'Directions')
  root.append(links)
  return root
}

interface Props {
  items: Amenity[]
  origin: { lat: number; lon: number }
  selected: Selection
  onSelect: (id: string) => void
}

export default function AmenityMarkers({ items, origin, selected, onSelect }: Props) {
  const map = useMap()
  const group = useRef<L.MarkerClusterGroup | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const g = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: clusterIcon,
    })
    map.addLayer(g)
    group.current = g
    return () => {
      map.removeLayer(g)
      group.current = null
    }
  }, [map])

  useEffect(() => {
    const g = group.current
    if (!g) return
    g.clearLayers()
    markers.current.clear()
    const list = items.map((a) => {
      const m = L.marker([a.lat, a.lon], { icon: ICONS[a.type], title: a.name, alt: a.name, keyboard: true })
      m.bindPopup(() => popupContent(a, origin), { maxWidth: 300 })
      m.on('click', () => onSelectRef.current(a.id))
      markerType.set(m, a.type)
      markers.current.set(a.id, m)
      return m
    })
    g.addLayers(list)
  }, [items, origin])

  // A row picked in the list: open its cluster (or spiderfied stack) and show the popup
  useEffect(() => {
    if (selected?.from !== 'list') return
    const m = markers.current.get(selected.id)
    if (m && group.current) group.current.zoomToShowLayer(m, () => m.openPopup())
  }, [selected])

  return null
}
