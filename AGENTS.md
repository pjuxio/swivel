# AGENTS.md

Guidance for AI coding agents working on SWIVEL. Human contributors should start with [README.md](README.md).

## What this is

SWIVEL is an MIT-licensed, open source map of what's near any US location. It's built to be cloned, run locally and
extended with new datasets.

- **Server:** a Node 22 / Express API in `server/` (plain JS, type-checked through JSDoc) searches bundled point
  datasets.
- **Front end:** a React 19 + Leaflet app in `src/` (TypeScript, Vite) shows results and county shading layers.
- **Data:** Python scripts in `scripts/` rebuild the bundled data.

## Commands

- `npm install`: install dependencies.
- `npm run dev`: API on :3001 and Vite on :5173 (proxies `/api`).
- `npm run check`: lint (oxlint), `tsc -b` (also type-checks `server/` through `tsconfig.server.json`), Vite build and
  `node:test`. **Run this before you finish any change**; CI runs the same steps.
- `npm test` on its own runs `test/`, including a validation pass over every bundled dataset.
- `npm run usage -- 30`: print the last 30 days of usage counts from the database in `DATABASE_URL`.

## Layout

- `server/app.js`: routes, input validation, rate limits, helmet/CSP, optional `APP_PASSWORD`.
- `server/datasets.js`: `LOADERS` maps each point layer type to a loader. `normalized(type, file)` reads the standard
  GeoJSON shape.
- `server/geo.js`: `inUS` bounds and `nearest()`. `server/geocode.js`: Nominatim proxy. `server/ev.js`: live EV API.
- `server/usage.js`: anonymous in-memory usage counters, flushed hourly. `server/usage-store.js`: optional Postgres
  store (`usage_daily` table), enabled by `DATABASE_URL`. `scripts/usage.js`: the `npm run usage` report.
- `src/amenities.ts`: `AmenityType`, `LAYERS` (point layers shown in the sidebar), `GROUPS`/`LayerGroup` and the API
  client.
- `src/choropleths.ts`: `CHOROPLETHS` county shading layers and the `ChoroplethConfig` interface.
- `src/App.tsx`: the map page. `src/Landing.tsx`: the landing page. `src/App.css`: all app styles.

## Adding data

Follow the README's "Adding your own data" section.

**Point layers** need four things kept in sync, or the API rejects the type or the dataset tests fail:

1. A GeoJSON file in `server/data/`, with `[lon, lat]` points and properties `id` (unique), `name`, and optionally
   `address`, `phone`, `website` and `details` as `[label, value]` pairs.
2. An entry in `LOADERS` in `server/datasets.js`.
3. The type in the `AmenityType` union in `src/amenities.ts`.
4. An entry in `LAYERS` in `src/amenities.ts`.

**County layers** need a JSON file in `src/data/` keyed by 5-digit FIPS, plus a `CHOROPLETHS` entry. Its `load` must
use a dynamic `import()` so the data stays out of the main bundle.

**Data scripts:** if you add a script in `scripts/`, give it a docstring with the source URL and usage, as the
existing scripts have. Don't hand-edit generated data files; change the script and rebuild.

## Rules

**Privacy**

- Never request device location except from the explicit "Use my location" action on the landing page.
- Keep coordinates in POST bodies, never in URLs or logs.
- Keep geocoding proxied through the server, and keep reverse lookups rounded.
- Usage counts must stay anonymous: never record coordinates, search text or IPs. Visitors are counted only as
  salted IP hashes in memory, with the salt discarded at UTC midnight. Only aggregate per-day counts may be logged
  or stored.
- The database is optional. The app must start and serve requests without `DATABASE_URL`, or when Postgres is down.

**US scope**

- Address search uses `countrycodes: 'us'` and points are filtered with `inUS`. Don't remove these unless the task is
  explicitly to support another country.

**Security**

- Links from datasets go through `httpUrl()`, which allows only http(s).
- The CSP allows only the OpenStreetMap tile hosts as third-party sources. If a change needs another origin, update
  the CSP in `server/app.js` deliberately.

**UI conventions**

- Main actions use `className="primary"`. That's the single purple button style; don't create another.
- Brand colors are the CSS variables in `src/index.css` (`--accent` purple, `--accent-2` cyan).
- Point layers go in their group's drawer. County shading layers go only in the "Map Layers" drawer, sub-grouped by
  `group`.
- Mobile (≤700px): the sidebar is a bottom sheet (`sheetOpen` in `App.tsx`). Wheel/touch raises it; Search, result
  taps and map taps lower it. Don't drive it from scroll events: the list scrolls programmatically when a map marker
  is selected.
- Keep the landing page and map sidebar copy consistent, for example the 911 safety line.

**Accessibility**

- Icon-only buttons need an `aria-label`.
- Respect `prefers-reduced-motion` for animations (see `GlowCanvas.tsx` and the sheet transition).

**Style**

- TypeScript in `src/`. Plain ES modules with JSDoc types in `server/`.
- Comment only what needs clarification.

**Docs**

- When behaviour, configuration or the data workflow changes, update README.md and this file in the same change.

**Don't commit**

- `.env.local`, secrets, API keys, or anything in `agent-reports/` (it's gitignored and holds local agent notes).

## Forks and deployment

The original instance is <https://swivel-app.com> on Heroku (`Procfile`, `heroku-postbuild`). Values specific to that
deployment:

- the canonical / Open Graph / Twitter URLs in `index.html`
- `SUPPORT_URL` in `src/SupportLink.tsx`
- `public/og-image.png`

Don't change them unless the task asks. Forks are told to replace them in the README.
