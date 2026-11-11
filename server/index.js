import { createApp, parseTrustProxy } from './app.js'

const PORT = Number(process.env.PORT) || 3001
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY)

const app = createApp({
  password: process.env.APP_PASSWORD || undefined,
  trustProxy,
  // HTTPS can only be detected behind a trusted proxy (Heroku sets NODE_ENV=production and DYNO);
  // FORCE_HTTPS=true/false overrides
  forceHttps: process.env.FORCE_HTTPS
    ? process.env.FORCE_HTTPS === 'true'
    : process.env.NODE_ENV === 'production' && trustProxy !== false,
})

app.listen(PORT, () => console.log(`SWIVEL listening on http://localhost:${PORT}`))
