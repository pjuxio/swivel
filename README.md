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

- `GET /api/amenities?lat=&lon=&radius=<meters, max 200000>&types=hospital,tri,...` returns
  `{ amenities, errors }`, nearest first, up to 300 per type.
- Static point datasets live in `server/data/` (built by `scripts/`) and are loaded into memory on first use.
- EV charging stations are fetched live from the DOE/NLR Alternative Fuels API with `NLR_API_KEY`
  (falls back to the shared `DEMO_KEY`, which is heavily rate limited) and cached for 10 minutes.
- County shading layers use the small JSON files in `src/data/` and stay in the browser bundle.

---

## Deploying to Heroku

The app is one Node process (Express serves `/api` and the built front end), so it deploys as-is.

```sh
heroku create <app-name>
heroku config:set NLR_API_KEY=<free key from https://developer.nlr.gov/signup/>
heroku config:set APP_PASSWORD=<shared password>   # optional: puts the whole app behind a password prompt
git push heroku main                                # or connect the GitHub repo in the dashboard
```

- `Procfile` runs `npm run server`; the `heroku-postbuild` script builds the front end; `engines` pins Node 22.
- With every layer loaded the server used about 280 MB of memory, so the 512 MB dynos have headroom but little to spare.
- `GET /api/health` is always open (use it for uptime checks); everything else requires the password when `APP_PASSWORD` is set.
- Any host that runs a Node server works the same way (build with `npm ci && npm run build`, start with `npm run server`).

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
