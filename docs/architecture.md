# Architecture

AfwaahTracker is a three-tier application with Oracle at its centre. React displays, Express orchestrates, Oracle stores and analyses.

```
┌──────────────────────────┐   HTTP / JSON    ┌─────────────────────────────┐  node-oracledb  ┌──────────────────────────┐
│ React + Vite (5173)      │ ───────────────▶ │ Node.js + Express (3000)    │  (Thin, pool)   │ Oracle Database Free/XE  │
│ Tailwind · Geist · Lucide│   /api/*         │ routes → controllers →      │ ──────────────▶ │ tables · constraints     │
│ Recharts · React Flow    │ ◀─────────────── │ services (SQL, bind vars)   │ ◀────────────── │ views · PL/SQL · triggers│
└──────────────────────────┘                  │ ingestion/ (node-cron)      │                 └──────────────────────────┘
                                              └──────────────┬──────────────┘
                                                             │ HTTPS
                                  ┌──────────────────────────┴──────────────────────────┐
                                  │ on demand: Brave Search API → public pages           │
                                  │ background: GDELT · Hacker News · RSS/Atom           │
                                  └──────────────────────────────────────────────────────┘
```

## Principles

- **The database does the work.** Echo Ratio, aggregates, lineage (hierarchical `CONNECT BY` queries), deduplication (unique indexes plus `INGEST_SOURCE`) and the Mutation Ledger (`GENERATE_MUTATION_LEDGER`, called by a compound trigger) all run in Oracle. React only renders the results.
- **No direct database access from the browser.** In development Vite proxies `/api` to Express. Oracle credentials and `BRAVE_SEARCH_API_KEY` live only in `server/.env`.
- **Bind variables everywhere.** Dynamic `WHERE` clauses are assembled only from fixed, server-defined fragments, and all values are bound.
- **Connection pooling.** `server/db/pool.js` creates one `oracledb` pool. `withTransaction()` commits on success and rolls back on any error.
- **No runtime AI.** Entity recognition, keyword detection, certainty and action detection and claim matching are dictionary and rule based.
- **Graceful degradation.** If Oracle is down the API answers `503 DB_UNAVAILABLE` and the UI shows an "Oracle database disconnected" panel. If a feed is unreachable the run is logged as `FAILED` and stored data stays available.

## Folder layout

```
afwaah-tracker/
├─ database/            SQL*Plus scripts (install.sql runs everything)
├─ server/
│  ├─ app.js            Express app (CORS, JSON, routes, error handler)
│  ├─ server.js         pool start-up, HTTP listener, scheduler
│  ├─ config/           .env loading
│  ├─ db/pool.js        oracledb pool, query helpers, transactions
│  ├─ middleware/       error types and friendly error mapping
│  ├─ routes/           REST route table
│  ├─ controllers/      HTTP layer
│  ├─ services/         SQL for claims, sources, overview, web search, ingestion, lab
│  ├─ web-search/       braveSearch.js · webInvestigator.js · pageFetcher.js ·
│  │                    pageExtractor.js · referenceExtractor.js
│  ├─ ingestion/        gdelt.js · hackerNews.js · rss.js · normalizer.js ·
│  │                    entityMatcher.js · matcher.js · sourceProcessor.js (shared by
│  │                    feeds and web search) · pipeline.js · scheduler.js
│  └─ scripts/          installDb.js · migrateDb.js · checkDb.js · runIngestion.js
├─ client/
│  └─ src/
│     ├─ components/    ui/ · claim/ · investigate/ · charts/ · layout/ · HeroRadar · ERDiagram
│     ├─ layouts/       AppLayout (navbar, geometric background, footer)
│     ├─ pages/         Home · Explore · Claim · Sources · DatabaseLab · 404
│     ├─ services/      api.js (REST client)
│     ├─ hooks/         useApi · useInvestigate · useRefresh (feed sync state)
│     ├─ utils/         formatting, Echo Ratio and live/demo wording helpers
│     └─ styles/        design tokens + Tailwind layers
└─ docs/
```

## Request flow: claim investigation

1. `GET /api/claims/1` reads `VW_CLAIM_OVERVIEW`, calls `CALCULATE_ECHO_RATIO(:id)`, and joins the fingerprint, entities, keywords and platform counts.
2. `GET /api/claims/1/sources` reads `VW_CLAIM_SOURCES` (variant → source → platform, with a self-join for "derived from").
3. `GET /api/claims/1/claim-lineage` runs a `CONNECT BY` over `CLAIM_VARIANTS.parent_variant_id`.
4. `GET /api/claims/1/source-lineage` walks `SOURCES.derived_from_source_id` upwards with `CONNECT BY` and joins `VW_SOURCE_LINEAGE` for depth.
5. `GET /api/claims/1/mutations` joins `CLAIM_MUTATIONS` to both variants and sources.

## Front end

- React Router routes: `/`, `/explore`, `/claims/:id`, `/sources`, `/lab`, `*`. Older addresses redirect (`/dashboard` → `/`, `/live` → `/lab`).
- **INVESTIGATE WEB** (`useInvestigate`) posts `/api/investigate-web` in async mode and opens `/explore?q=…&run=<id>`, which polls the run status, then loads the results.
- `RefreshProvider` holds the *SYNC FEEDS* state in the Database Lab. When a sync completes it increments a version counter, and every `useApi` hook refetches.
- Explore and Sources keep their filters in the URL, and every filter is sent to the API (server-side SQL).
