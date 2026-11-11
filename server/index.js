import { createApp, parseTrustProxy } from './app.js'
import { createUsage } from './usage.js'
import { createPgStore, wantsSsl } from './usage-store.js'

const PORT = Number(process.env.PORT) || 3001
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY)

/** @type {Awaited<ReturnType<typeof createPgStore>> | null} */
let store = null
const dbUrl = process.env.DATABASE_URL
if (dbUrl) {
  try {
    store = await createPgStore(dbUrl, { ssl: wantsSsl(dbUrl) })
  } catch (e) {
    // usage counts are optional, so the app still starts and only logs them
    console.error('usage store unavailable:', /** @type {Error} */ (e).message)
  }
}
const usage = createUsage({ store })
usage.start()

const app = createApp({
  usage,
  password: process.env.APP_PASSWORD || undefined,
  trustProxy,
  // HTTPS can only be detected behind a trusted proxy (Heroku sets NODE_ENV=production and DYNO);
  // FORCE_HTTPS=true/false overrides
  forceHttps: process.env.FORCE_HTTPS
    ? process.env.FORCE_HTTPS === 'true'
    : process.env.NODE_ENV === 'production' && trustProxy !== false,
})

app.listen(PORT, () => console.log(`SWIVEL listening on http://localhost:${PORT}`))
