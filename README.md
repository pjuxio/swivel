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
