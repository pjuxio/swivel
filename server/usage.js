import crypto from 'node:crypto'

/** @typedef {{ add: (day: string, counts: Record<string, number>) => Promise<void> }} UsageStore */

/**
 * Anonymous usage counters. Coordinates, search text and IPs are never recorded; visitors are counted by hashing the
 * IP with a random per-day salt that only lives in memory and is discarded at UTC midnight.
 *
 * Counts are printed as a JSON log line and, when a `store` is given, added to it as deltas on every flush. Because
 * the salt is not persisted, a visitor seen again after a restart is counted again, so stored `visitors` are an
 * upper bound while the other counts are exact.
 * @param {{ log?: (line: string) => void, now?: () => Date, store?: UsageStore | null }} [opts]
 */
export function createUsage({ log = console.log, now = () => new Date(), store = null } = {}) {
  /** @type {{ day: string, salt: string, visitors: Set<string>, requests: Record<string, number>, layers: Record<string, number> }} */
  let state = fresh()
  let dirty = false
  /** Counts not yet written to the store, by day. @type {Map<string, Record<string, number>>} */
  let pending = new Map()
  /** @type {Promise<void>} */
  let writing = Promise.resolve()

  function fresh() {
    return {
      day: now().toISOString().slice(0, 10),
      salt: crypto.randomBytes(16).toString('hex'),
      visitors: new Set(),
      requests: {},
      layers: {},
    }
  }

  /** @param {string} metric */
  function bump(metric, n = 1) {
    const day = pending.get(state.day) ?? {}
    day[metric] = (day[metric] ?? 0) + n
    pending.set(state.day, day)
  }

  function snapshot() {
    return { day: state.day, visitors: state.visitors.size, requests: state.requests, layers: state.layers }
  }

  /** Log a snapshot (when something changed) and write the new counts to the store. */
  function flush() {
    if (dirty) {
      dirty = false
      log(`usage ${JSON.stringify(snapshot())}`)
    }
    if (!store || !pending.size) return writing
    const batch = pending
    pending = new Map()
    writing = writing.then(async () => {
      for (const [day, counts] of batch) {
        try {
          await store.add(day, counts)
        } catch (e) {
          console.error('usage store:', /** @type {Error} */ (e).message)
          // keep the counts for the next flush
          for (const [metric, n] of Object.entries(counts)) {
            const d = pending.get(day) ?? {}
            d[metric] = (d[metric] ?? 0) + n
            pending.set(day, d)
          }
        }
      }
    })
    return writing
  }

  /**
   * @param {{ ip?: string }} req
   * @param {string} endpoint
   * @param {string[]} [layers] layer types searched
   */
  function record(req, endpoint, layers = []) {
    if (now().toISOString().slice(0, 10) !== state.day) {
      flush()
      state = fresh()
    }
    const visitor = crypto.createHash('sha256').update(state.salt + (req.ip ?? 'unknown')).digest('hex')
    if (!state.visitors.has(visitor)) {
      state.visitors.add(visitor)
      bump('visitors')
    }
    state.requests[endpoint] = (state.requests[endpoint] ?? 0) + 1
    bump(`request:${endpoint}`)
    for (const t of new Set(layers)) {
      state.layers[t] = (state.layers[t] ?? 0) + 1
      bump(`layer:${t}`)
    }
    dirty = true
  }

  /** Flush every `intervalMs` and on shutdown. @param {number} [intervalMs] */
  function start(intervalMs = 3_600_000) {
    setInterval(flush, intervalMs).unref()
    process.once('SIGTERM', () => {
      flush().finally(() => process.exit(0))
    })
  }

  return { record, snapshot, flush, start }
}
