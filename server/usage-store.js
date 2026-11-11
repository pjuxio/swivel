import pg from 'pg'

/**
 * Daily usage counts in Postgres, one row per day and metric (`visitors`, `request:amenities`, `layer:hospital`...).
 * @param {string} connectionString
 * @param {{ ssl?: boolean }} [opts] defaults to TLS without certificate checks, which Heroku Postgres needs
 */
export async function createPgStore(connectionString, { ssl = true } = {}) {
  const pool = new pg.Pool({ connectionString, max: 2, ssl: ssl ? { rejectUnauthorized: false } : false })
  pool.on('error', (e) => console.error('usage store:', e.message)) // a dropped idle connection must not crash the app
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usage_daily (
      day date NOT NULL,
      metric text NOT NULL,
      n bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (day, metric)
    )`)
  return {
    /** @param {string} day @param {Record<string, number>} counts */
    async add(day, counts) {
      const metrics = Object.keys(counts)
      await pool.query(
        `INSERT INTO usage_daily (day, metric, n)
         SELECT $1::date, m, c FROM unnest($2::text[], $3::bigint[]) AS t(m, c)
         ON CONFLICT (day, metric) DO UPDATE SET n = usage_daily.n + EXCLUDED.n`,
        [day, metrics, metrics.map((m) => counts[m])],
      )
    },
    /** @param {number} days */
    async recent(days) {
      const { rows } = await pool.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, metric, n::int AS n FROM usage_daily
         WHERE day > current_date - $1::int ORDER BY day DESC, metric`,
        [days],
      )
      return /** @type {{ day: string, metric: string, n: number }[]} */ (rows)
    },
    end: () => pool.end(),
  }
}

/** Heroku Postgres needs TLS; a local database usually has none. @param {string} url */
export const wantsSsl = (url) => !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) && !/sslmode=disable/.test(url)
