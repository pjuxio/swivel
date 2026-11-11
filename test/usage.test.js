import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createUsage } from '../server/usage.js'

describe('usage counters', () => {
  it('counts requests, layers and distinct visitors without storing identifiers', () => {
    /** @type {string[]} */
    const lines = []
    const u = createUsage({ log: (l) => lines.push(l) })
    u.record({ ip: '1.2.3.4' }, 'amenities', ['hospital', 'police', 'hospital'])
    u.record({ ip: '1.2.3.4' }, 'geocode')
    u.record({ ip: '5.6.7.8' }, 'amenities', ['hospital'])
    u.flush()
    assert.equal(lines.length, 1)
    assert.ok(!lines[0].includes('1.2.3.4'))
    const snap = JSON.parse(lines[0].replace(/^usage /, ''))
    assert.equal(snap.visitors, 2)
    assert.deepEqual(snap.requests, { amenities: 2, geocode: 1 })
    assert.deepEqual(snap.layers, { hospital: 2, police: 1 })
    u.flush()
    assert.equal(lines.length, 1, 'nothing new, nothing logged')
  })

  it('starts a fresh day at UTC midnight and logs the previous one', () => {
    /** @type {string[]} */
    const lines = []
    let t = new Date('2026-01-01T23:59:00Z')
    const u = createUsage({ log: (l) => lines.push(l), now: () => t })
    u.record({ ip: 'a' }, 'amenities', ['tri'])
    t = new Date('2026-01-02T00:01:00Z')
    u.record({ ip: 'a' }, 'amenities', ['tri'])
    assert.equal(lines.length, 1)
    assert.equal(JSON.parse(lines[0].replace(/^usage /, '')).day, '2026-01-01')
    assert.equal(u.snapshot().day, '2026-01-02')
    assert.equal(u.snapshot().requests.amenities, 1)
  })
})

describe('usage store', () => {
  it('adds only new counts on each flush and keeps them when a write fails', async () => {
    /** @type {{ day: string, counts: Record<string, number> }[]} */
    const writes = []
    let fail = false
    const store = {
      /** @param {string} day @param {Record<string, number>} counts */
      async add(day, counts) {
        if (fail) throw new Error('db down')
        writes.push({ day, counts })
      },
    }
    const u = createUsage({ log: () => {}, store })
    u.record({ ip: 'a' }, 'amenities', ['tri'])
    u.record({ ip: 'a' }, 'amenities', ['tri'])
    await u.flush()
    assert.deepEqual(writes.pop()?.counts, { visitors: 1, 'request:amenities': 2, 'layer:tri': 2 })

    await u.flush()
    assert.equal(writes.length, 0, 'nothing new, nothing written')

    fail = true
    const err = console.error
    console.error = () => {}
    u.record({ ip: 'a' }, 'geocode')
    await u.flush()
    console.error = err
    fail = false
    u.record({ ip: 'b' }, 'geocode')
    await u.flush()
    assert.deepEqual(writes.pop()?.counts, { 'request:geocode': 2, visitors: 1 })
  })
})
