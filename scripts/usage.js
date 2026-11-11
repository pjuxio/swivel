// Prints the last N days (default 14) of stored usage counts: npm run usage -- 30
import { createPgStore, wantsSsl } from '../server/usage-store.js'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Set DATABASE_URL (Heroku: DATABASE_URL=$(heroku config:get DATABASE_URL) npm run usage).')
  process.exit(1)
}

const store = await createPgStore(url, { ssl: wantsSsl(url) })
const rows = await store.recent(Number(process.argv[2]) || 14)
await store.end()

/** @type {Map<string, Record<string, number>>} */
const days = new Map()
for (const { day, metric, n } of rows) days.set(day, { ...days.get(day), [metric]: n })
for (const [day, m] of days) {
  const layers = Object.entries(m)
    .filter(([k]) => k.startsWith('layer:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => `${k.slice(6)} ${n}`)
    .join(', ')
  console.log(
    `${day}  visitors<=${m.visitors ?? 0}  searches ${m['request:amenities'] ?? 0}  ` +
      `geocode ${m['request:geocode'] ?? 0}  reverse ${m['request:reverse'] ?? 0}  top layers: ${layers || '-'}`,
  )
}
if (!days.size) console.log('No usage recorded yet.')
