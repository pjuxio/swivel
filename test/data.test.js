import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { SUNDOWN_STATUSES, STATIC_TYPES, httpUrl, loadStatic } from '../server/datasets.js'
import { inUS, nearest } from '../server/geo.js'
import { reverseGeocode } from '../server/geocode.js'

describe('httpUrl', () => {
  test('repairs and rejects', () => {
    assert.equal(httpUrl('https://a.org/x'), 'https://a.org/x')
    assert.equal(httpUrl('www.pawhuskahospital.org'), 'https://www.pawhuskahospital.org/')
    assert.equal(httpUrl('stroudhospital.com/'), 'https://stroudhospital.com/')
    assert.equal(httpUrl('www.amctoday.org/\u200e'), 'https://www.amctoday.org/')
    assert.equal(httpUrl(' HTTP://A.org '), 'http://a.org/')
    assert.equal(httpUrl('javascript:alert(1)'), undefined)
    assert.equal(httpUrl('mailto:x@y.org'), undefined)
    assert.equal(httpUrl('not a url'), undefined)
    assert.equal(httpUrl(''), undefined)
    assert.equal(httpUrl(null), undefined)
  })
})

describe('geo', () => {
  test('inUS', () => {
    assert.ok(inUS(40.7, -74)) // NYC
    assert.ok(inUS(61.2, -149.9)) // Anchorage
    assert.ok(inUS(21.3, -157.8)) // Honolulu
    assert.ok(inUS(18.4, -66.1)) // San Juan
    assert.ok(inUS(17.7, -64.8)) // St Croix
    assert.ok(inUS(13.4, 144.8)) // Guam
    assert.ok(!inUS(0, 0))
    assert.ok(!inUS(13.1, -59.6)) // Barbados
    assert.ok(!inUS(7.35, 134.46)) // Palau
  })

  test('nearest sorts, filters and reports the uncut total', () => {
    const items = [0.01, 0.03, 0.02, 5].map((d, i) => ({ id: i, lat: 40 + d, lon: -74 }))
    const { hits, total } = nearest(items, 40, -74, 10_000, 2)
    assert.equal(total, 3)
    assert.deepEqual(hits.map((h) => h.a.id), [0, 2])
  })
})

describe('datasets', () => {
  for (const type of STATIC_TYPES) {
    test(type, async () => {
      const list = await loadStatic(type)
      assert.ok(list.length > 0, 'not empty')
      const ids = new Set()
      for (const a of list) {
        const where = `${a.id} ${a.name}`
        assert.equal(a.type, type, where)
        assert.ok(typeof a.id === 'string' && a.id, `id: ${where}`)
        assert.ok(!ids.has(a.id), `duplicate id: ${where}`)
        ids.add(a.id)
        assert.ok(typeof a.name === 'string' && a.name.trim(), `name: ${where}`)
        assert.ok(inUS(a.lat, a.lon), `outside the US: ${where} ${a.lat},${a.lon}`)
        for (const u of [a.website, ...(a.links ?? []).map((l) => l.url)]) {
          if (u !== undefined) assert.match(u, /^https?:\/\//, where)
        }
      }
    })
  }

  test('sundown towns hold only sundown claims, with the status in details', async () => {
    for (const a of await loadStatic('sundown_town')) {
      const status = a.details?.find((d) => d.label === 'Sundown town?')?.value
      assert.ok(status && SUNDOWN_STATUSES.has(status), a.name)
      assert.ok(!a.address?.startsWith('Sundown town?'), a.name)
    }
  })

  test('hospital websites without a scheme are kept', async () => {
    const list = await loadStatic('hospital')
    assert.ok(list.find((a) => a.website === 'https://www.pawhuskahospital.org/'))
  })
})

describe('geocoder', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('reverse lookups send coarse coordinates and identify the app', async () => {
    /** @type {{ url: string, headers: Record<string, string> }[]} */
    const calls = []
    globalThis.fetch = /** @type {typeof fetch} */ (
      async (url, init) => {
        calls.push({ url: String(url), headers: /** @type {Record<string, string>} */ (init?.headers) })
        return new Response(JSON.stringify({ address: { city: 'New York', state: 'New York' } }))
      }
    )
    assert.equal(await reverseGeocode(40.712776, -74.005974), 'New York, New York')
    const url = new URL(calls[0].url)
    assert.equal(url.searchParams.get('lat'), '40.71')
    assert.equal(url.searchParams.get('lon'), '-74.01')
    assert.match(calls[0].headers['User-Agent'], /^SWIVEL\//)

    // Nearby points share the cached answer
    assert.equal(await reverseGeocode(40.7111, -74.0099), 'New York, New York')
    assert.equal(calls.length, 1)
  })
})
