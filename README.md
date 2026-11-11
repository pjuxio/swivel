# SWIVEL

Safety Warning & Instant Vigilance Emergency Link: a map of what's around you (public safety, transportation,
social, demographic and environmental data) with county-level shading layers.

## Running

The point datasets (hospitals, police, TRI facilities, ...) are served by a small Node/Express API in
[server/](server). The browser asks it for the places near a location instead of downloading whole datasets.

```sh
npm install
cp .env.example .env.local   # optional: add a free NLR_API_KEY for EV chargers
npm run dev                  # API on :3001 + Vite on :5173 (proxies /api to the API)
```

`npm run dev:api` and `npm run dev:web` run each half on its own.

Production: `npm start` builds the app and serves it plus `/api` on `PORT` (default 3001).

## Checks

```sh
npm run lint    # oxlint
npm run build   # type-checks the app, the server (JSDoc + checkJs) and builds the front end
npm test        # node:test suites in test/: API behaviour and validation of every bundled dataset
npm run check   # all three; CI (.github/workflows/ci.yml) runs the same steps
```

## API

All endpoints except `/api/health` are `POST` with a JSON body, so coordinates stay out of URLs and access logs.

- `POST /api/amenities` with `{ lat, lon, radius, types }` (`radius` in meters, max 200000; `types` an array such as
  `["hospital", "tri"]`) returns `{ amenities, counts, errors }`. Amenities are nearest first, each with a `distance`
  in meters, and at most 500 per type. `counts[type]` is `{ shown, total }`; `total > shown` means the layer was cut.
- `POST /api/geocode` with `{ q }` returns `{ hit: { lat, lon } | null }`.
- `POST /api/reverse` with `{ lat, lon }` returns `{ name }`.
- `GET /api/health` returns `{ ok: true }` and is always open (use it for uptime checks).

Notes:

- Static point datasets live in `server/data/` (built by `scripts/`) and are loaded into memory on first use. The
  loader drops points outside the US and its territories, repairs website links that lack `https://`, and keeps only
  sundown-town records with a status of Possible, Probable or Surely.
- EV charging stations are fetched live from the DOE/NLR Alternative Fuels API with `NLR_API_KEY`
  (falls back to the shared `DEMO_KEY`, which is heavily rate limited) and cached for 10 minutes.
- Geocoding is proxied to Nominatim, which then sees only the server, not the user. Reverse lookups are rounded to
  about 1 km, responses are cached for a day, and requests are spaced at least a second apart, as Nominatim's usage
  policy requires. Set `NOMINATIM_EMAIL` to identify the app to them.
- County shading layers use the small JSON files in `src/data/` and stay in the browser bundle. Their configuration
  (scales, legends, notes) lives in [src/choropleths.ts](src/choropleths.ts).
- The app opens on a landing page where you choose a location, either with "Use my location" or by entering an
  address. The browser only asks for the device location after "Use my location" is pressed. On the map, double click to
  move the point or press ✕ next to the place name to return to the landing page. The point is kept for the browser tab, so a
  refresh stays on the map.

## Data scripts

The Python scripts in `scripts/` rebuild the files in `server/data/` and `src/data/`. Most need only the standard
library; install the rest with `pip install -r scripts/requirements.txt`. `data_centers.geojson` and
`superfund_sites.geojson` were downloaded by hand and have no build script. `npm test` validates every point dataset
(US coordinates, unique ids, names, http(s) links), so run it after a rebuild.

## Deploying to Heroku

The app is one Node process (Express serves `/api` and the built front end), so it deploys as-is.

```sh
heroku create <app-name>
heroku config:set NLR_API_KEY=<free key from https://developer.nlr.gov/signup/>
heroku config:set APP_PASSWORD=<shared password>   # optional: puts the whole app behind a password prompt
git push heroku main                                # or connect the GitHub repo in the dashboard
```

- `Procfile` runs `npm run server`; the `heroku-postbuild` script builds the front end; `engines` pins Node 22.
- On Heroku the server trusts the router's `X-Forwarded-*` headers, redirects HTTP to HTTPS and sends HSTS.
- Responses are gzip-compressed; hashed files under `/assets` are cached for a year and everything else is revalidated.
- Security headers (CSP, `X-Content-Type-Options`, frame blocking) are set by `helmet`. Map tiles are the only
  third-party resource the page loads.
- With `APP_PASSWORD` set, 10 wrong passwords from one IP lock it out for 15 minutes.
- With every layer loaded the server used about 280 MB of memory, so the 512 MB dynos have headroom but little to spare.

Other hosts work the same way (build with `npm ci && npm run build`, start with `npm run server`). Behind a reverse
proxy set `TRUST_PROXY` to the number of proxy hops so client IPs and HTTPS are detected correctly; without a proxy
leave it unset, so clients can't spoof `X-Forwarded-For` to dodge the rate limits. See [.env.example](.env.example).
