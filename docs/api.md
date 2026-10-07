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
| `INTERNAL_ERROR` | 500 | Anything else. No stack traces are returned |

## Read endpoints

| Method & path | Description |
|---|---|
| `GET /health` | API and database status, pool statistics |
| `GET /dashboard` | Metrics, high-echo claims, most repeated, platform and category distribution, recent claims, 14-day ingestion activity, last refresh by source type |
| `GET /search?q=` | Same as `/claims`, ordered by relevance. Every term must match the claim, a variant, a source title or publisher, an entity alias or a keyword |
| `GET /claims` | Claim families from `VW_CLAIM_OVERVIEW`. Query params: `q`, `platform` (id), `category` (id), `status` (`UNVERIFIED`… or `CURATED` = everything except candidates), `echoBand`, `dateFrom`, `dateTo`, `sourceType` (`DEMO`, `AUTOMATED`, `MANUAL`, `GDELT`, `HACKER_NEWS`, `RSS`), `sort` (`newest`, `sources`, `echo`, `platforms`, `relevance`), `limit` (≤100), `offset` |
| `GET /claims/:id` | Overview, PL/SQL Echo Ratio (`echo_ratio_plsql`), fingerprint, entities, keywords, platforms |
| `GET /claims/:id/sources` | Sources and claim versions (`VW_CLAIM_SOURCES`), with dependency, upstream publisher and an `is_earliest` flag |
| `GET /claims/:id/variants` | Structured variants with match score, method and breakdown |
| `GET /claims/:id/mutations` | Mutation Ledger rows with from/to source details |
| `GET /claims/:id/claim-lineage` | `{ nodes, edges }` from a `CONNECT BY` over `parent_variant_id` |
| `GET /claims/:id/source-lineage` | `{ nodes, edges }`: the claim's sources plus every upstream ancestor |
| `GET /sources` | Query params: `q` (publisher/title/URL/author/claim), `platform`, `origin`, `sourceType`, `dependency`, `claim`, `dateFrom`, `dateTo`, `sort` (`newest`, `oldest`, `fetched`, `publisher`, `engagement`), `limit`, `offset` |
| `GET /sources/:id` | Source, linked claims, derived children and upstream chain |
| `GET /platforms` | `VW_PLATFORM_STATISTICS` |
| `GET /categories` | Categories with claim counts |
| `GET /entities?type=&q=` | Entity dictionary with aliases and claim counts |
| `GET /ingestion/status` | Scheduler state, 24-hour summary, last refresh per type, every feed's latest run, the last 25 runs |
| `GET /ingestion/feed?limit=&sourceType=` | Latest automatically ingested sources with their matched claim and score |
| `GET /lab` | Schema introspection (object counts, constraints, relationships, PL/SQL units, views, indexes, row counts) and the example query list |
| `GET /lab/queries/:key` | Runs one **whitelisted** read-only example query. Arbitrary SQL is never accepted |

## Write endpoints

| Method & path | Body |
|---|---|
| `POST /ingestion/refresh` | none. Fetches every enabled feed now and waits for the run (or joins one in progress). Returns `{ totals, results[] }` |
| `POST /claims` | `{ canonical_claim, category_id, status?, summary?, fingerprint?: { core_assertion, sentiment, emotional_hook, manipulation_marker, source_pattern, notes } }` |
| `PUT /claims/:id` | any of `canonical_claim`, `category_id`, `status`, `summary` |
| `DELETE /claims/:id` | cascades to variants, mutations, links and fingerprint (sources are kept) |
| `POST /claims/:id/variants` | `{ variant_text, source_id \| source: {publisher, source_title, source_url, platform_id, published_at?, ...}, parent_variant_id?, actor?, action?, target_object?, location_name?, event_name?, claimed_date?, quantity_value?, certainty?, attribution? }`. Runs `ADD_CLAIM_VARIANT`, and the trigger writes the Mutation Ledger |
| `POST /sources` | `{ publisher, source_title, source_url, platform_id, published_at?, author?, snippet?, engagement_count?, derived_from_source_id?, provenance_note? }` |
| `PUT /sources/:id` | any of the fields above plus `source_status` |

### Example

```bash
curl "http://localhost:3000/api/search?q=Aakash%20Gupta%20VIT"
curl  http://localhost:3000/api/claims/1/mutations
curl -X POST http://localhost:3000/api/ingestion/refresh
```
