# REST API

Base URL: `http://localhost:3000/api`. All responses are JSON. Errors have this shape:

```json
{ "error": { "code": "DB_UNAVAILABLE", "message": "The Oracle database is not reachable. ..." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `DB_UNAVAILABLE` | 503 | Oracle is not reachable. The pool reconnects automatically |
| `NOT_FOUND` | 404 | Unknown record or route |
| `VALIDATION_ERROR` | 400 | Bad input |
| `BUSINESS_RULE` | 400 | A PL/SQL `RAISE_APPLICATION_ERROR` (e.g. parent variant from another claim) |
| `DUPLICATE` | 409 | Unique constraint (e.g. source URL already stored) |
| `UNAUTHORIZED` / `FORBIDDEN` | 401 / 403 | Write/admin endpoint without a valid `ADMIN_TOKEN` (production without a token: always 403) |
| `TOO_MANY_REQUESTS` / `DAILY_LIMIT` | 429 | Per-IP rate limit, or the site-wide daily cap on new web searches |
| `INTERNAL_ERROR` | 500 | Anything else. No stack traces are returned |

## Read endpoints

| Method & path | Description |
|---|---|
| `GET /health` | API and database status, pool statistics |
| `GET /overview` | Home overview: claim, source, web-run and reference counts, the latest investigations, `webSearchAvailable` (`/dashboard` is an alias) |
| `GET /web-search/:runId/status` | Progress of a run: `status`, current `stage` (searching, normalising, removing duplicates, fetching, matching, building relationships) and the counts |
| `GET /web-search/:runId/results` | The run (`VW_WEB_SEARCH_RUNS`), its claim families (with `run_sources` and `strong_family`), `strongFamilyDetected`, related sources and stored claim families that match the query |
| `GET /web-search?limit=` | Recent web search runs |
| `GET /claims` | Claim families from `VW_CLAIM_OVERVIEW`. Query params: `q`, `platform` (id), `category` (id), `status` (`UNVERIFIED`… or `CURATED` = everything except candidates), `echoBand`, `dateFrom`, `dateTo`, `origin` (`LIVE`, `DEMO`), `run` (search run id), `sourceType` (`DEMO`, `AUTOMATED`, `WEB_SEARCH`, `MANUAL`, `GDELT`, `HACKER_NEWS`, `RSS`), `sort` (`newest`, `sources`, `echo`, `platforms`, `relevance`), `limit` (≤100), `offset` |
| `GET /claims/:id` | Overview, PL/SQL Echo Ratio (`echo_ratio_plsql`), fingerprint, entities, keywords, platforms |
| `GET /claims/:id/sources` | Sources and claim versions (`VW_CLAIM_SOURCES`), with dependency, upstream publisher, `lineage_basis`, match breakdown and an `is_earliest` flag (first dated source; undated sources sort last) |
| `GET /claims/:id/variants` | Structured variants with match score, method and breakdown |
| `GET /claims/:id/mutations` | Mutation Ledger rows with from/to source details |
| `GET /claims/:id/claim-lineage` | `{ nodes, edges }` from a `CONNECT BY` over `parent_variant_id` |
| `GET /claims/:id/source-lineage` | `{ nodes, edges }`: the claim's sources plus every upstream ancestor |
| `GET /sources` | Query params: `q` (publisher/title/URL/author/claim), `platform`, `retrieval` (`WEB_SEARCH`, `FEED`, `MANUAL`, `DEMO`), `run`, `sourceType`, `dependency` (`KNOWN_DERIVED`, `NO_KNOWN_UPSTREAM`), `claim`, `dateFrom`, `dateTo`, `sort` (`newest`, `oldest`, `fetched`, `publisher`, `engagement`), `limit`, `offset` |
| `GET /sources/:id` | Source, linked claims, derived children, upstream chain, explicit references in both directions and the search runs that returned it |
| `GET /platforms` | `VW_PLATFORM_STATISTICS` |
| `GET /categories` | Categories with claim counts |
| `GET /entities?type=&q=` | Entity dictionary with aliases and claim counts |
| `GET /ingestion/status` | Background feeds: scheduler state, 24-hour summary, every feed's latest run, the last 25 runs, 14-day activity |
| `GET /lab` | Schema introspection (object counts, constraints, relationships, PL/SQL units, views, indexes, row counts) and the example query list |
| `GET /lab/queries/:key` | Runs one **whitelisted** read-only example query. Arbitrary SQL is never accepted |

## Write endpoints

All endpoints in this table except `POST /investigate-web` are **admin endpoints**: in production they require `Authorization: Bearer <ADMIN_TOKEN>` and are disabled when no token is configured. `POST /investigate-web` is public but rate-limited (per IP, per day, and in Nginx).

| Method & path | Body |
|---|---|
| `POST /investigate-web` | `{ query, async? }`. Creates a `WEB_SEARCH_RUNS` row, searches the web (Tavily), stores and analyses each result in its own transaction, then returns `{ searchRunId, query, status, resultsReceived, sourcesAnalysed, sourcesInserted, duplicatesSkipped, pagesFetched, pagesFailed, claimsMatched, claimsCreated, claimFamilies }`. With `async: true` it answers `202 { searchRunId }` immediately and the run continues; poll `/web-search/:id/status`. Without `TAVILY_API_KEY` the run is stored as `FAILED` with a clear message |
| `POST /ingestion/refresh` | none. Fetches every enabled feed now and waits for the run (or joins one in progress). Returns `{ totals, results[] }` |
| `POST /claims` | `{ canonical_claim, category_id, status?, summary?, fingerprint?: { core_assertion, sentiment, emotional_hook, manipulation_marker, source_pattern, notes } }` |
| `PUT /claims/:id` | any of `canonical_claim`, `category_id`, `status`, `summary` |
| `DELETE /claims/:id` | cascades to variants, mutations, links and fingerprint (sources are kept) |
| `POST /claims/:id/variants` | `{ variant_text, source_id \| source: {publisher, source_title, source_url, platform_id, published_at?, ...}, parent_variant_id?, actor?, action?, target_object?, location_name?, event_name?, claimed_date?, quantity_value?, certainty?, attribution? }`. Runs `ADD_CLAIM_VARIANT`, and the trigger writes the Mutation Ledger |
| `POST /sources` | `{ publisher, source_title, source_url, platform_id, published_at?, author?, snippet?, engagement_count?, derived_from_source_id?, provenance_note? }` |
| `PUT /sources/:id` | any of the fields above plus `source_status` |

### Example

```bash
curl -X POST http://localhost:3000/api/investigate-web -H "Content-Type: application/json" -d "{\"query\":\"city bans plastic bags\"}"
curl "http://localhost:3000/api/claims?q=Aakash%20Gupta%20VIT"
curl  http://localhost:3000/api/claims/1/mutations
curl -X POST http://localhost:3000/api/ingestion/refresh
```
