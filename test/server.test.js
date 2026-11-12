import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { createApp, MAX_RESULTS } from '../server/app.js'
import { countiesNear } from '../server/counties.js'
import { circleTouchesRing } from '../server/geo.js'
import { fetchAlerts, toAlert } from '../server/weather.js'

const NYC = { lat: 40.7128, lon: -74.006 }

/** @param {import('express').Express} app */
async function serve(app) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  const base = `http://127.0.0.1:${port}`
  return {
    /** @param {string} p @param {RequestInit} [init] */
    fetch: (p, init) => fetch(base + p, init),
    /** @param {string} p @param {unknown} body @param {Record<string, string>} [headers] */
    post: (p, body, headers = {}) =>
      fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
    close: () => new Promise((r) => server.close(r)),
  }
}

const stubs = {
  /** @param {number} lat @param {number} lon */
  ev: async (lat, lon) => ({
    stations: [{ id: 'ev/1', type: 'ev_charger', name: 'Charger', lat: lat + 0.001, lon, details: [] }],
    total: 900,
  }),
  geocode: {
    /** @param {string} q */
    geocode: async (q) => (q === 'nowhere' ? null : { lat: 1, lon: 2 }),
    reverseGeocode: async () => 'Somewhere, NY',
  },
  /** @param {number} lat @param {number} _lon @param {number} radius */
  alerts: async (lat, _lon, radius) => {
    if (lat === 41) throw new Error('boom')
    return [{ id: 'a1', event: 'Flood Warning', severity: 'Severe', atPoint: radius === 0 }]
  },
}

describe('API', () => {
  /** @type {Awaited<ReturnType<typeof serve>>} */
  let s
  before(async () => {
    s = await serve(createApp({ distDir: null, ...stubs }))
  })
  after(() => s.close())

  test('health', async () => {
    const res = await s.fetch('/api/health')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  })

  test('rejects bad input', async () => {
    const cases = [
      { lat: '', lon: '', radius: 1000, types: ['hospital'] },
      { lat: null, lon: 0, radius: 1000, types: ['hospital'] },
      { lat: 91, lon: 0, radius: 1000, types: ['hospital'] },
      { ...NYC, radius: 0, types: ['hospital'] },
      { ...NYC, radius: 200_001, types: ['hospital'] },
      { ...NYC, radius: 1000, types: [] },
      { ...NYC, radius: 1000, types: ['__proto__'] },
      { ...NYC, radius: 1000, types: 'hospital' },
      { ...NYC, radius: 1000, types: [{}] },
    ]
    for (const body of cases) {
      const res = await s.post('/api/amenities', body)
      assert.equal(res.status, 400, JSON.stringify(body))
    }
  })

  test('coordinates are not accepted in the query string', async () => {
    const res = await s.fetch(`/api/amenities?lat=${NYC.lat}&lon=${NYC.lon}&radius=1000&types=hospital`)
    assert.equal(res.status, 404)
  })

  test('reports how many results were cut', async () => {
    const res = await s.post('/api/amenities', { ...NYC, radius: 100_000, types: ['fire_station', 'ice_office'] })
    assert.equal(res.status, 200)
    const { amenities, counts, errors } = /** @type {any} */ (await res.json())
    assert.deepEqual(errors, {})
    assert.equal(counts.fire_station.shown, MAX_RESULTS)
    assert.ok(counts.fire_station.total > MAX_RESULTS, 'NYC has more fire stations than the cap')
    assert.equal(counts.ice_office.shown, counts.ice_office.total)
    assert.equal(amenities.length, counts.fire_station.shown + counts.ice_office.shown)
    for (let i = 1; i < amenities.length; i++) assert.ok(amenities[i].distance >= amenities[i - 1].distance)
  })

  test('live EV results carry the upstream total', async () => {
    const res = await s.post('/api/amenities', { ...NYC, radius: 5000, types: ['ev_charger'] })
    const { amenities, counts } = /** @type {any} */ (await res.json())
    assert.equal(amenities.length, 1)
    assert.deepEqual(counts.ev_charger, { shown: 1, total: 900 })
  })

  test('geocoding goes through the server', async () => {
    let res = await s.post('/api/geocode', { q: 'Albany, NY' })
    assert.deepEqual(await res.json(), { hit: { lat: 1, lon: 2 } })
    res = await s.post('/api/geocode', { q: 'nowhere' })
    assert.deepEqual(await res.json(), { hit: null })
    res = await s.post('/api/geocode', { q: '' })
    assert.equal(res.status, 400)
    res = await s.post('/api/reverse', { lat: 40.71234, lon: -74.00612 })
    assert.deepEqual(await res.json(), { name: 'Somewhere, NY' })
    res = await s.post('/api/reverse', { lat: '', lon: '' })
    assert.equal(res.status, 400)
  })

  test('weather alerts', async () => {
    let res = await s.post('/api/alerts', NYC)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { alerts: [{ id: 'a1', event: 'Flood Warning', severity: 'Severe', atPoint: true }] })
    res = await s.post('/api/alerts', { ...NYC, radius: 5000 })
    assert.equal((/** @type {any} */ (await res.json())).alerts[0].atPoint, false, 'the radius reaches the fetcher')
    for (const radius of [-1, 200_001, 'x']) {
      res = await s.post('/api/alerts', { ...NYC, radius })
      assert.equal(res.status, 400, String(radius))
    }
    res = await s.post('/api/alerts', { lat: 51.5, lon: -0.12 })
    assert.deepEqual(await res.json(), { alerts: [] }, 'no lookup outside the US')
    res = await s.post('/api/alerts', { lat: '', lon: '' })
    assert.equal(res.status, 400)
    res = await s.post('/api/alerts', { lat: 41, lon: -74 })
    assert.equal(res.status, 502)
    res = await s.fetch(`/api/alerts?lat=${NYC.lat}&lon=${NYC.lon}`)
    assert.equal(res.status, 404, 'coordinates are not accepted in the query string')
  })

  test('security headers', async () => {
    const res = await s.fetch('/api/health')
    const csp = res.headers.get('content-security-policy') ?? ''
    assert.match(csp, /default-src 'self'/)
    assert.match(csp, /frame-ancestors 'none'/)
    assert.doesNotMatch(csp, /upgrade-insecure-requests/)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('x-powered-by'), null)
    assert.equal(res.headers.get('strict-transport-security'), null, 'no HSTS without HTTPS')
  })

  test('responses are compressed', async () => {
    const res = await s.post('/api/amenities', { ...NYC, radius: 25_000, types: ['police'] }, { 'Accept-Encoding': 'gzip' })
    assert.equal(res.headers.get('content-encoding'), 'gzip')
  })
})

describe('toAlert', () => {
  const base = { id: 'x', status: 'Actual', messageType: 'Alert', event: 'Heat Advisory', severity: 'Minor' }
  const later = new Date(Date.now() + 3_600_000).toISOString()

  test('keeps a live alert and trims it to the fields we show', () => {
    const a = toAlert({ ...base, ends: later, areaDesc: 'Kings, NY', geocode: { UGC: ['NYC047'] }, description: '  Hot.  ' })
    assert.deepEqual(JSON.parse(JSON.stringify(a)), {
      id: 'x',
      event: 'Heat Advisory',
      severity: 'Minor',
      areaDesc: 'Kings, NY',
      description: 'Hot.',
      expires: later,
    })
  })

  test('drops tests, cancellations and expired alerts', () => {
    assert.equal(toAlert({ ...base, status: 'Test' }), null)
    assert.equal(toAlert({ ...base, messageType: 'Cancel' }), null)
    assert.equal(toAlert({ ...base, ends: new Date(Date.now() - 1000).toISOString() }), null)
    assert.equal(toAlert({ ...base, event: '' }), null)
  })

  test('unknown severities are normalised', () => {
    assert.equal(toAlert({ ...base, severity: '<script>' })?.severity, 'Unknown')
  })
})

describe('circle and polygon geometry', () => {
  // A 0.1 degree square (about 11 km) centred on (40, -100)
  /** @type {[number, number][]} */
  const square = [[-100.05, 39.95], [-99.95, 39.95], [-99.95, 40.05], [-100.05, 40.05], [-100.05, 39.95]]

  test('circleTouchesRing', () => {
    assert.ok(circleTouchesRing(40, -100, 100, square), 'center inside')
    assert.ok(circleTouchesRing(40, -100.2, 20_000, square), 'edge reaches the circle')
    assert.ok(circleTouchesRing(40, -100, 100_000, square), 'polygon entirely inside the circle')
    assert.ok(!circleTouchesRing(40, -100.2, 5_000, square), 'too far')
    assert.ok(!circleTouchesRing(41, -100, 50_000, square), 'too far north')
  })

  test('countiesNear uses the real county shapes', () => {
    const small = countiesNear(40.7128, -74.006, 500)
    assert.ok(small.has('36061'), 'New York County')
    assert.ok(!small.has('36047'), 'Kings County is across the river')
    const wide = countiesNear(40.7128, -74.006, 25_000)
    for (const fips of ['36061', '36047', '36081', '34017']) assert.ok(wide.has(fips), fips)
  })
})

describe('fetchAlerts with the radius', () => {
  const props = (/** @type {string} */ id, /** @type {string[]} */ same, extra = {}) => ({
    id, status: 'Actual', messageType: 'Alert', event: id, severity: 'Moderate', geocode: { SAME: same }, ...extra,
  })
  const square = {
    type: 'Polygon',
    coordinates: [[[-74.05, 40.68], [-73.95, 40.68], [-73.95, 40.78], [-74.05, 40.78], [-74.05, 40.68]]],
  }
  const features = [
    { properties: props('manhattan-zone', ['036061']), geometry: null },
    { properties: props('kings-zone', ['036047']), geometry: null },
    { properties: props('far', ['006037']), geometry: null },
    { properties: props('polygon-warning', ['006037'], { severity: 'Extreme' }), geometry: square },
  ]
  const realFetch = globalThis.fetch
  /** @type {string[]} */
  let urls = []
  before(() => {
    globalThis.fetch = /** @type {typeof fetch} */ (async (/** @type {string} */ url) => {
      urls.push(String(url))
      const point = String(url).includes('point=')
      const body = point ? { features: [{ properties: props('at-point', [], { severity: 'Minor' }) }] } : { features }
      return new Response(JSON.stringify(body), { status: 200 })
    })
  })
  after(() => {
    globalThis.fetch = realFetch
  })

  test('adds nearby county and polygon alerts, flagging the one at the point', async () => {
    const alerts = await fetchAlerts(40.7128, -74.006, 3000)
    assert.deepEqual(
      alerts.map((a) => [a.id, a.atPoint]),
      [['polygon-warning', false], ['manhattan-zone', false], ['kings-zone', false], ['at-point', true]],
    )
    assert.ok(alerts[0].geometry, 'polygons are returned for drawing')
    assert.equal(alerts[1].geometry, undefined)
  })

  test('a small radius leaves out alerts for other counties', async () => {
    const alerts = await fetchAlerts(40.7128, -74.006, 200)
    assert.deepEqual(alerts.map((a) => a.id), ['polygon-warning', 'manhattan-zone', 'at-point'])
  })

  test('no radius means point alerts only, without the nationwide request', async () => {
    urls = []
    const alerts = await fetchAlerts(41.5, -73.5, 0)
    assert.deepEqual(alerts.map((a) => a.id), ['at-point'])
    assert.equal(urls.length, 1)
  })
})

describe('rate limiting', () => {
  test('429 carries Retry-After', async () => {
    const s = await serve(createApp({ distDir: null, ...stubs }))
    try {
      let res
      for (let i = 0; i < 31; i++) res = await s.post('/api/geocode', { q: 'x' })
      assert.equal(res?.status, 429)
      assert.ok(Number(res?.headers.get('retry-after')) > 0)
    } finally {
      await s.close()
    }
  })
})

describe('password mode', () => {
  /** @type {Awaited<ReturnType<typeof serve>>} */
  let s
  /** @param {string} pw */
  const auth = (pw) => ({ Authorization: `Basic ${Buffer.from(`any:${pw}`).toString('base64')}` })
  before(async () => {
    s = await serve(createApp({ distDir: null, password: 'hunter2', ...stubs }))
  })
  after(() => s.close())

  test('health stays open, everything else needs the password', async () => {
    assert.equal((await s.fetch('/api/health')).status, 200)
    assert.equal((await s.fetch('/api/nope')).status, 401)
    assert.equal((await s.fetch('/api/nope', { headers: auth('hunter2') })).status, 404)
  })

  test('wrong passwords are throttled', async () => {
    let res
    for (let i = 0; i < 10; i++) {
      res = await s.fetch('/', { headers: auth(`wrong${i}`) })
      assert.equal(res.status, 401)
    }
    res = await s.fetch('/', { headers: auth('hunter2') })
    assert.equal(res.status, 429, 'locked out even with the right password')
    assert.ok(Number(res.headers.get('retry-after')) > 0)
  })
})

describe('HTTPS', () => {
  /** @type {Awaited<ReturnType<typeof serve>>} */
  let s
  before(async () => {
    s = await serve(createApp({ distDir: null, trustProxy: true, forceHttps: true, ...stubs }))
  })
  after(() => s.close())

  test('plain HTTP is redirected', async () => {
    const res = await s.fetch('/somewhere?x=1', { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'http' } })
    assert.equal(res.status, 308)
    assert.equal(res.headers.get('location'), 'https://127.0.0.1/somewhere?x=1')
  })

  test('health checks are not redirected', async () => {
    const res = await s.fetch('/api/health', { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'http' } })
    assert.equal(res.status, 200)
  })

  test('HSTS over HTTPS', async () => {
    const res = await s.fetch('/api/health', { headers: { 'X-Forwarded-Proto': 'https' } })
    assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=31536000/)
  })
})

describe('static files', () => {
  /** @type {Awaited<ReturnType<typeof serve>>} */
  let s
  let dir = ''
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swivel-dist-'))
    fs.mkdirSync(path.join(dir, 'assets'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>SWIVEL</title>')
    fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)'.repeat(200))
    fs.writeFileSync(path.join(dir, 'favicon.svg'), '<svg/>')
    s = await serve(createApp({ distDir: dir, ...stubs }))
  })
  after(async () => {
    await s.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('hashed assets are cached for a year', async () => {
    const res = await s.fetch('/assets/app-abc123.js', { headers: { 'Accept-Encoding': 'gzip' } })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(res.headers.get('content-encoding'), 'gzip')
  })

  test('other files and the app shell are revalidated', async () => {
    assert.equal((await s.fetch('/favicon.svg')).headers.get('cache-control'), 'no-cache')
    const res = await s.fetch('/some/route')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-cache')
    assert.match(await res.text(), /SWIVEL/)
  })

  test('missing assets are 404, not the app shell', async () => {
    assert.equal((await s.fetch('/assets/old-chunk.js')).status, 404)
    assert.equal((await s.fetch('/missing.png')).status, 404)
  })
})
