import { LAYERS, type Amenity } from './amenities'

const HEADERS = ['Layer', 'Name', 'Distance (m)', 'Latitude', 'Longitude', 'Address', 'Phone', 'Website', 'Details', 'Links']

function cell(value: string | number | undefined): string {
  let s = value === undefined ? '' : String(value)
  // Stop spreadsheets from running dataset text as a formula (numbers such as -74.0 are left alone)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function amenitiesToCsv(items: Amenity[]): string {
  const rows = items.map((a) => [
    LAYERS.find((l) => l.type === a.type)?.label ?? a.type,
    a.name,
    Math.round(a.distance),
    a.lat,
    a.lon,
    a.address,
    a.phone,
    a.website,
    a.details?.map((d) => `${d.label}: ${d.value}`).join('; '),
    a.links?.map((l) => `${l.title} (${l.url})`).join('; '),
  ])
  // CRLF line endings and a BOM so Excel reads the file as UTF-8
  return '\uFEFF' + [HEADERS, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function downloadCsv(items: Amenity[]) {
  const url = URL.createObjectURL(new Blob([amenitiesToCsv(items)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `swivel-listings-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
