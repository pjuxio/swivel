# SWIVEL

**Safety Warning & Instant Vigilance Entity Lookup.** Know what's around you.

SWIVEL is an open source map of what's near any location in the United States: hospitals, police, transit,
pollution sources, community and historical data. On top of that, you can shade counties by demographics, health,
environment, election results and connectivity. It runs locally with one command, and you can add your own datasets.

![SWIVEL](public/og-image.png)

Live instance: <https://swivel-app.com>

## Features

- **Nearby search:** pick any of 18 point layers and a radius (1–100 km) to list the nearest places, nearest first,
  with details and links.
- **Weather alerts:** live National Weather Service watches, warnings and advisories at the search point or anywhere
  within the selected radius, in a banner on the map. Warning polygons are outlined on the map. Refreshed every
  5 minutes.
- **CSV export:** download the listings on screen as a CSV file. It's built in the browser, so nothing extra is sent
  to the server.
- **County map layers:** 21 county shading layers (demographics, health, environment, elections, mobile coverage)
  with legends. One is shown at a time.
- **Privacy:**
  - The browser only asks for your location after you press "Use my location". You can always type an address
    instead.
  - Coordinates travel in POST bodies, not URLs.
  - Geocoding is proxied, so Nominatim never sees the user.
- **Mobile:** on phones the panel is a bottom sheet. Scroll it to cover the map; Search lowers it.
- **Self-contained:** one Node process serves the API and the front end. Point data is bundled in the repo, so only
  EV charging stations, weather alerts, geocoding and map tiles call outside services.

## Quick start

You need [Node.js 22](https://nodejs.org/) and npm. Python 3 is only needed to rebuild datasets.

```sh
git clone https://github.com/pjuxio/swivel.git
cd swivel
npm install
cp .env.example .env.local   # optional; every setting has a default
npm run dev                  # API on http://localhost:3001 + app on http://localhost:5173
```

Open <http://localhost:5173>. `npm run dev:api` and `npm run dev:web` run each half on its own; Vite proxies `/api` to
the API.

To run it like production (one process serving the built app and `/api` on `PORT`, default 3001):

```sh
npm start
```

## Configuration

All settings are environment variables, read from `.env.local` in development. See [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `NLR_API_KEY` | `DEMO_KEY` | Free key from <https://developer.nlr.gov/signup/> for live EV charging stations. The shared demo key is heavily rate limited. |
| `NOMINATIM_EMAIL` | none | Contact email sent with geocoding requests, as Nominatim's usage policy asks. Set it if you run a public instance. |
| `NWS_CONTACT` | `NOMINATIM_EMAIL` | Contact email sent in the User-Agent of National Weather Service requests, as the NWS API asks. |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Point at your own or a commercial Nominatim server. |
| `APP_PASSWORD` | none | Puts the whole app behind a shared password (any username). |
| `PORT` | `3001` | Port for the API / production server. |
| `TRUST_PROXY` | `1` on Heroku, off elsewhere | Number of reverse proxy hops to trust for client IPs and HTTPS. |
| `FORCE_HTTPS` | on in production behind a proxy | Redirect HTTP to HTTPS and send HSTS. |
| `DATABASE_URL` | none | Postgres connection string. When set, anonymous usage counts are stored in a `usage_daily` table. Heroku Postgres sets it for you. |

## Project layout

```
server/            Express API (plain JS, type-checked through JSDoc)
  app.js           routes, validation, rate limits, security headers
  datasets.js      point dataset loaders (LOADERS) and normalisation
  ev.js            live EV charging stations (DOE AFDC)
  geocode.js       Nominatim proxy with rounding, caching and throttling
  weather.js       live weather alerts (National Weather Service), at a point or within a radius
  counties.js      which counties touch a circle (from src/data/counties.topo.json)
  geo.js           US bounds check and nearest-first search
  data/            bundled point datasets (GeoJSON)
src/               React + Leaflet front end (TypeScript)
  App.tsx          map page: sidebar, search, results, bottom sheet
  exportCsv.ts     builds and downloads the results CSV
  Landing.tsx      landing page (location choice)
  amenities.ts     point layer list (LAYERS), groups and API client
  choropleths.ts   county shading layers (CHOROPLETHS)
  data/            bundled county data (JSON keyed by FIPS) and county shapes
scripts/           Python scripts that rebuild server/data and src/data
test/              node:test suites for the API and every bundled dataset
public/            static files: icons, manifest, share image
```

## Adding your own data

SWIVEL has two kinds of layer, and both are plain files in the repo.

### A point layer (places you can search for)

1. **Make a GeoJSON file** in `server/data/`, for example `server/data/shelters.geojson`. Use one `Point` feature per
   place, with `[longitude, latitude]` coordinates and these properties:

   ```json
   {
     "type": "Feature",
     "geometry": { "type": "Point", "coordinates": [-73.9857, 40.7484] },
     "properties": {
       "id": "shelter/1",
       "name": "Midtown Community Shelter",
       "address": "123 Example St, New York, NY 10001",
       "phone": "(212) 555-0100",
       "website": "https://example.org",
       "details": [["Capacity", "120"], ["Pets allowed", "Yes"]]
     }
   }
   ```

   - `id` and `name` are required, and `id` must be unique within the file.
   - `address`, `phone`, `website` and `details` (a list of `[label, value]` pairs) are optional.
   - Websites without a scheme get `https://`, and points outside the US and its territories are dropped on load.

2. **Register it with the server:** add `shelter: normalized('shelter', 'shelters.geojson')` to `LOADERS` in
   [server/datasets.js](server/datasets.js). If your source has a different shape, write a custom loader instead;
   `loadDataCenters` and `loadSuperfund` are examples.

3. **Show it in the app:** in [src/amenities.ts](src/amenities.ts), add `'shelter'` to the `AmenityType` union and
   an entry to `LAYERS`:

   ```ts
   { type: 'shelter', group: 'public_safety', label: 'Shelters', color: '#7b1fa2', emoji: '🏠', source: 'My city open data' },
   ```

   `group` decides which sidebar drawer it appears in. Add a group to `LayerGroup` and `GROUPS` if you need a new one.

4. **Run `npm run check`.** The dataset tests load every entry in `LOADERS` and fail on missing names, duplicate ids,
   points outside the US or links that aren't http(s).

Each search returns at most 500 places per layer, nearest first, and the app says when results were cut.

### A county shading layer

1. **Make a JSON file** in `src/data/` keyed by 5-digit county FIPS code:

   ```json
   { "36061": { "name": "New York County, NY", "value": 42.5 }, "06037": { "name": "Los Angeles County, CA", "value": 17.1 } }
   ```

2. **Add an entry to `CHOROPLETHS`** in [src/choropleths.ts](src/choropleths.ts). The `ChoroplethConfig` interface
   documents every field: `scale` (ascending `[minimum, color]` steps), `format`, legend text, a `note` shown under
   the legend, and `load`, which dynamically imports your file so it only downloads when the layer is turned on.
   `life` is a short example to copy.

3. **Pick the shapes.** Set `shapes` to `'counties'` for standard county FIPS. If your data uses Connecticut's nine
   planning regions (`09110`–`09190`, as recent Census releases do), use `'acs'`.

The layer appears in the **Map Layers** drawer under its `group`.

### Rebuilding the bundled data

The Python scripts in `scripts/` download public sources and rewrite the files in `server/data/` and `src/data/`.
Each script's docstring explains its source and usage, for example `python3 scripts/fetch_datasets.py hospital police`.
Most need only the standard library; install the rest with `pip install -r scripts/requirements.txt`. Run
`npm test` after a rebuild.

- **No build script:** `data_centers.geojson`, `superfund_sites.geojson`, `violentcrime.json` and
  `ct_regions.json` were prepared by hand.
- **Manual download first:** `build_mobile.py` needs a file downloaded from the FCC, and `build_lead.py` downloads
  about 560 MB.

## Running your own public instance

When you fork SWIVEL and host it yourself, change the parts that point at the original deployment:

- **Domain:** in [index.html](index.html), replace `https://swivel-app.com/` in the canonical link and the Open
  Graph / Twitter tags with your own domain.
- **Support link:** set `SUPPORT_URL` in [src/SupportLink.tsx](src/SupportLink.tsx) to your own donation page, or
  remove the `<SupportLink />` elements.
- **Share image:** replace `public/og-image.png` (1200×630) if you change the branding.
- **Geocoding:** set `NOMINATIM_EMAIL`. For real traffic, use your own or a commercial geocoder through
  `NOMINATIM_URL`; the public Nominatim server allows about one request per second.
- **Map tiles:** these come from `tile.openstreetmap.org` (set in [src/App.tsx](src/App.tsx)). Its
  [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) doesn't allow heavy use, so busy
  instances should switch to a tile provider of their own.
- **US-only behaviour:** this is deliberate. Address search is limited to the US (`countrycodes` in
  [server/geocode.js](server/geocode.js)), and points are checked against US bounds in
  [server/geo.js](server/geo.js). Change both if you adapt SWIVEL to another country.

## Checks

```sh
npm run lint    # oxlint
npm run build   # type-checks the app and the server (JSDoc + checkJs) and builds the front end
npm test        # node:test suites in test/: API behaviour and validation of every bundled dataset
npm run check   # all three; CI (.github/workflows/ci.yml) runs the same steps
```

## API

All endpoints except `/api/health` are `POST` with a JSON body, so coordinates stay out of URLs and access logs.

- **`POST /api/amenities`** with `{ lat, lon, radius, types }` (`radius` in meters, max 200000; `types` an array
  such as `["hospital", "tri"]`) returns `{ amenities, counts, errors }`.
  - `amenities` are nearest first, each with a `distance` in meters, and at most 500 per type.
  - `counts[type]` is `{ shown, total }`; `total > shown` means the layer was cut.
- **`POST /api/geocode`** with `{ q }` returns `{ hit: { lat, lon } | null }`.
- **`POST /api/reverse`** with `{ lat, lon }` returns `{ name }`.
- **`POST /api/alerts`** with `{ lat, lon, radius }` (`radius` in meters, optional, max 200000) returns `{ alerts }`:
  the active NWS alerts at that point or within the radius, most severe first (`id`, `event`, `severity`,
  `headline`, `areaDesc`, `sender`, `description`, `instruction`, `expires`, `atPoint`, and a GeoJSON `geometry`
  when NWS drew a polygon). Without `radius` only alerts at the point are returned. Points outside the US return an
  empty list.
- **`GET /api/health`** returns `{ ok: true }` and is always open (use it for uptime checks).

How it behaves:

- **Point data:** static datasets are loaded into memory on first use. The loader repairs website links that lack
  `https://`, drops points outside the US and its territories, and keeps only sundown-town records with a status of
  Possible, Probable or Surely.
- **EV charging stations:** fetched live from the DOE/NLR Alternative Fuels API and cached for 10 minutes.
- **Weather alerts:** fetched from the NWS API (`api.weather.gov`, no key needed) through the server. Alerts at the
  point come from NWS's own lookup (the point is rounded to about 100 m) and are cached for 2 minutes. For the
  radius, the server keeps one shared 2-minute copy of every active US alert and keeps those whose polygon touches
  the circle or, for alerts that only list counties, whose counties touch it (using the bundled county shapes). Test,
  cancelled and expired alerts are dropped. The browser refreshes every 5 minutes and when the tab becomes visible
  again.
- **Geocoding:** proxied to Nominatim, which sees only the server, not the user. Reverse lookups are rounded to
  about 1 km, responses are cached for a day, and requests are spaced at least a second apart.
- **County layers:** their data stays in the browser bundle and is loaded per layer.
- **Usage counts:** the server logs an anonymous snapshot, `usage {"day":"2026-01-01","visitors":12,"requests":{...},"layers":{...}}`,
  hourly when something changed and on shutdown. It has request counts per endpoint, searches per layer and distinct
  visitors. Coordinates, search text and IPs are never recorded; visitors are counted by hashing the IP with a random
  salt that is discarded at UTC midnight.
  - **Persistence:** with `DATABASE_URL` set (for example the Heroku Postgres add-on), the same counts are also added
    to a `usage_daily` table (created on startup), so they survive restarts and deploys. If the database is down the
    counts are kept and retried, and the app still starts.
  - **Reading it:** `DATABASE_URL=$(heroku config:get DATABASE_URL) npm run usage -- 30` prints the last 30 days.
  - **Visitors:** the salt is not persisted, so a visitor seen again after a restart counts again. Stored `visitors`
    is an upper bound; the other counts are exact.
- **App flow:** the app opens on a landing page where you choose a location.
  - On the map, double click to move the point, or press ✕ next to the place name to go back to the landing page.
  - The point is kept for the browser tab, so a refresh stays on the map.

## Deploying

The app is one Node process (Express serves `/api` and the built front end), so most Node hosts work. Build with
`npm ci && npm run build`, start with `npm run server`. Behind a reverse proxy, set `TRUST_PROXY` to the number of
proxy hops so client IPs and HTTPS are detected correctly. Without a proxy, leave it unset, so clients can't spoof
`X-Forwarded-For` to dodge the rate limits.

### Heroku

```sh
heroku create <app-name>
heroku config:set NLR_API_KEY=<free key from https://developer.nlr.gov/signup/>
heroku config:set NOMINATIM_EMAIL=<your contact email>
heroku config:set APP_PASSWORD=<shared password>   # optional: puts the whole app behind a password prompt
git push heroku main                                # or connect the GitHub repo in the dashboard
```

- **Build and run:** `Procfile` runs `npm run server`, the `heroku-postbuild` script builds the front end, and
  `engines` pins Node 22.
- **HTTPS:** on Heroku the server trusts the router's `X-Forwarded-*` headers, redirects HTTP to HTTPS and sends HSTS.
- **Caching:** responses are gzip-compressed. Hashed files under `/assets` are cached for a year; everything else is
  revalidated.
- **Security headers:** `helmet` sets CSP, `X-Content-Type-Options` and frame blocking. Map tiles are the only
  third-party resource the page loads.
- **Password lockout:** with `APP_PASSWORD` set, 10 wrong passwords from one IP lock it out for 15 minutes.
- **Memory:** with every layer loaded the server uses about 280 MB, so 512 MB dynos have headroom but little to spare.

## Data sources and licensing

The **code** is released under the [MIT License](LICENSE). The **bundled datasets are not**: each keeps the terms of
its original publisher. Most are US government works in the public domain; others (for example the Tougaloo College
sundown towns database) are published by organisations with their own terms. Check a source's terms
before redistributing its data or using it commercially. Listings may be out of date, so verify anything you rely on.

| Layer | Source |
|---|---|
| Hospitals, police, fire stations, prisons and jails | HIFLD (Homeland Infrastructure Foundation-Level Data) |
| Urgent care | HIFLD (via ArcGIS) |
| Airports, military installations, Amtrak stations | US DOT National Transportation Atlas Database |
| ICE field offices | ICE ERO field office list (community-maintained) |
| EV charging stations | DOE Alternative Fuels Data Center (live API) |
| Sundown towns (historical) | Tougaloo College Sundown Towns Database |
| Data centers | Open Data Center Data |
| Greenhouse gas emitters | EPA Greenhouse Gas Reporting Program 2023 |
| TRI facilities, brownfields | EPA Facility Registry Service (TRI, ACRES) |
| Landfills | EPA Landfill Methane Outreach Program |
| Superfund sites | EPA National Priorities List |
| PFAS (sites and county) | EPA UCMR 5 |
| Lead in drinking water | EPA SDWA / ECHO Lead and Copper Rule results |
| Air quality | EPA annual AQI by county, 2024 |
| Environmental justice | CDC/ATSDR Environmental Justice Index 2024 |
| Demographics, poverty, income, broadband | Census ACS 2020–2024 5-year, via Census Reporter |
| Life expectancy | County Health Rankings 2025 |
| Violent crime rate | County Health Rankings 2022 |
| Hate crimes | FBI Crime Data Explorer, 2020–2024 |
| Presidential results | [tonmcg/US_County_Level_Election_Results_08-24](https://github.com/tonmcg/US_County_Level_Election_Results_08-24) |
| Mobile 4G / 5G coverage | FCC Broadband Data Collection |
| Weather alerts | [National Weather Service](https://www.weather.gov/documentation/services-web-api) |
| Basemap, geocoding | © OpenStreetMap contributors, Nominatim |

## Contributing

Issues and pull requests are welcome, especially new datasets, fixes to stale data and accessibility improvements.
Please run `npm run check` before opening a pull request. Contributors using AI coding agents should point them at
[AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © 2026 PJUX
