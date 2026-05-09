# desi

A Vite + React + TypeScript SPA paired with an Express API in a single repo,
deployable to [Render](https://render.com) as one Node service. Express serves
the built SPA from `/dist` and exposes `/api/*` routes on the same port.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS v4 (via the official `@tailwindcss/vite` plugin)
- Express 4 (TypeScript, ESM)
- `dotenv` for env vars

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

This runs:

- Vite dev server at `http://localhost:5173` (the app)
- Express API at `http://localhost:3001`

Vite proxies `/api/*` to the API, so the frontend can call `fetch('/api/compare')`
in both dev and production without configuration.

## Production build

```bash
npm run build
npm start
```

`npm run build` produces:

- `/dist` — built SPA (static assets)
- `/dist-server` — compiled Express server

`npm start` runs the compiled server, which serves the SPA from `/dist` and
exposes `/api/*` routes on `PORT` (defaults to 3001).

## Environment variables

Create a `.env` file (or set these in Render's dashboard):

| Variable             | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `PIPESHIFT_API_KEY`  | Pipeshift — long-context model inference and the NLP parse step      |
| `HYDRADB_API_KEY`    | HydraDB — corpus storage / retrieval (queryable context layer)       |
| `THINE_API_KEY`      | Thine — structured memory across comparisons                         |
| `PORT`               | API port (Render injects this automatically; defaults to `3001`)     |

The vendor clients are stubbed in [`server/clients/`](server/clients/) — they
read their respective env vars but contain no real logic yet.

## Deploy to Render

Create a new **Web Service** on Render pointed at this repo:

- **Environment**: Node
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Environment Variables**: add `PIPESHIFT_API_KEY`, `HYDRADB_API_KEY`, `THINE_API_KEY`

Render injects `PORT` and sets `NODE_ENV=production` by default. The server
binds to `process.env.PORT` and serves the built SPA from `/dist` whenever
that directory exists, so a single service handles both the static site and
the API.

## Project layout

```
src/                      React SPA
  components/
    StageCard.tsx         Pending/Running/Done card with citation slot
    SourcesPanel.tsx      Right-rail source list (placeholder)
  App.tsx                 Landing form + 5-stage comparison view
  main.tsx
  index.css               @import "tailwindcss"
server/                   Express API
  index.ts                App entry, static SPA serving, /api wiring
  routes/
    compare.ts            POST /api/compare (stubbed parse → mock JSON)
  clients/
    pipeshift.ts          TODO: long-context inference + NLP parse
    hydra.ts              TODO: corpus storage / retrieval
    thine.ts              TODO: structured memory across comparisons
vite.config.ts            React + Tailwind plugins, /api proxy → :3001
tsconfig.json             Client TS config
tsconfig.server.json      Server TS config (NodeNext, emits dist-server/)
```

## Current behavior

1. Landing page asks "What would you like to compare?" with a single text
   input and Submit button.
2. Submit POSTs the raw text to `/api/compare`. The endpoint stubs the parse
   step and returns a hardcoded `{ optionA, optionB, domain }`.
3. The UI then renders five vertically stacked stage cards — Ingest,
   Extract Criteria, Score, Cross-Reference, Verdict — each in a `pending`
   state with a placeholder for tier-tagged citations, plus a Sources panel
   on the right.

No real pipeline logic is implemented yet — this is the working skeleton.
