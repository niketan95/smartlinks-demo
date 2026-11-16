# Smart links live demo

```
smartlinks-demo/
├── package.json        # setup + dev scripts (runs all three with concurrently)
├── server/
│   ├── index.js        # Express API: click routing, conversion postbacks, SSE stream
│   └── traffic.js      # Mock clickstream generator
└── client/             # Vite + React + Recharts dashboard
    ├── vite.config.js  # proxies /api -> localhost:4000
    └── src/App.jsx, index.css
```

## Run (Node 18+)

```
npm run setup   # installs root, server, client
npm run dev     # API :4000, dashboard :5173, traffic script
```

Open http://localhost:5173. Reroutes start within ~20 seconds.

Run pieces separately if you prefer: `npm start --prefix server`, `npm run dev --prefix client`, `npm run traffic`.

## Tuning the demo

| Env var (traffic.js) | Default | Effect |
|---|---|---|
| `RATE` | 8 | clicks per second |
| `SHOCK_SECONDS` | 20 | how often a store suddenly converts much better or worse |
| `API_URL` | http://localhost:4000 | target API |

Example: `RATE=20 SHOCK_SECONDS=10 npm run traffic`

Routing knobs (epsilon, decay window, switch margin) are at the top of `server/index.js`.

## How routing works

Each smart link has several stores. 90% of clicks go to the active store; 10% go to the others so they stay measured. Each store's recent conversion rate is a decayed, smoothed estimate. When another store beats the active one by 2+ points, the link reroutes and a `reroute` event is pushed to the dashboard. The traffic script holds the "true" rates (hidden from the API) and shocks them periodically, so the API has to discover the change from conversions alone.

## API

- `POST /api/click { linkId }` → `{ clickId, storeId, explore }`
- `POST /api/conversion { clickId, orderValue }` → `{ commission }`
- `GET /api/stream` SSE: `snapshot` every second, plus `reroute`, `conversion`, `reset`
- `GET /api/state`, `POST /api/reset`

## Deploy (one public URL)

In production the API serves the built dashboard and, with `DEMO_TRAFFIC=1`, runs the traffic script itself.

Local check: `npm run build && DEMO_TRAFFIC=1 npm start` → http://localhost:4000

Render: push to GitHub, then New → Blueprint → pick the repo (uses `render.yaml`).

## Login

Visitors click "Continue as visitor" and get a view-only dashboard. Sign in with any email plus the shared password in `DEMO_PASSWORD` (default `smartlinks` when unset) to reset data and use presenter controls.
Set it on Render under the service's Environment tab. Sessions live in memory, so a restart signs everyone out.

## Setup screens (owner only)

- **Connections:** connect each store's affiliate program by entering your tracking ID. Switch the demo region between United States ($) and India (₹); each has its own stores and sample links. Store list lives in `server/catalog.js`.
- **Links:** create, edit and delete smart links; import the affiliate links a creator already uses (store is detected from the URL, or picked manually for Linktree, Wishlink, LTK or bit.ly links).

Everything is kept in memory, so links and connections go back to the sample set when the server restarts.
