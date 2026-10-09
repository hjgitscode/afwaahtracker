# AfwaahTracker

**Trace the claim. Find the source. See what changed.**

AfwaahTracker is a live claim investigation system built on Oracle Database. Type a claim, person, event or topic and press **INVESTIGATE WEB**. The server retrieves relevant publicly indexed sources through the Tavily Search API, fetches the public pages, extracts their metadata, groups them into claim families with deterministic rules, stores everything in Oracle, and shows:

- every source in publication order (the **earliest known source found**),
- which sources explicitly link to earlier reporting (**known upstream links**),
- how the wording changed (**claim lineage** and the PL/SQL **Mutation Ledger**),
- the **Known Echo Ratio**: the share of retrieved sources with a detected upstream source.

> Known Echo Ratio measures detected source dependence among retrieved sources. It does not prove that sources without a known parent are independent, and it does not measure truthfulness.

```
React + Vite (5173) ──REST──▶ Express (3000) ──node-oracledb pool──▶ Oracle Database Free (1521, Docker)
                                 │
                                 ├── on demand: Tavily Search API → public pages → rule-based matching
                                 └── background: node-cron feeds (GDELT · Hacker News · RSS/Atom)
```

React displays. Express orchestrates. Oracle stores and analyses. The browser never connects to Oracle and never sees the search API key. No AI models, embeddings or machine learning are used anywhere: matching, lineage and the ledger are fixed, documented rules.

---

## Running it on Windows (Docker Desktop)

You need **Node.js 18.18+** and **Docker Desktop** with the Oracle container created earlier (`afwaah-oracle`).

1. **Start Docker Desktop**, then start the database:
   ```bat
   docker start afwaah-oracle
   ```
   Wait until `docker logs afwaah-oracle` shows `DATABASE IS READY TO USE!`.

2. **Configure the server.** In the project folder:
   ```bat
   copy server\.env.example server\.env
   ```
   (Skip the copy if `server\.env` already exists.) Open `server\.env` and check the Oracle settings:
   ```ini
   DB_USER=afwaah
   DB_PASSWORD=afwaah
   DB_CONNECT_STRING=localhost:1521/FREEPDB1
   ```
   Then set up live web search:
   1. Create a free account at <https://tavily.com>.
   2. Copy your API key from the Tavily dashboard.
   3. Paste it into `server\.env`:
      ```ini
      TAVILY_API_KEY=your_key_here
      ```

   Tavily currently offers a free API tier with a limited number of credits. AfwaahTracker uses one basic search request per investigation, and repeating the same query within two minutes reuses the earlier run instead of searching again.
   The key lives only in `server\.env`, which is git-ignored. Without a key the app still works with stored data and background feeds and shows *"Live web search unavailable — showing stored sources."*

3. **Install packages** (first time only):
   ```bat
   npm run install-all
   ```

4. **Prepare the database**
   - Existing database from an earlier version — keep all data and upgrade:
     ```bat
     npm run db:migrate
     ```
   - Fresh database (or to reset to the demonstration state):
     ```bat
     npm run db:install
     ```

5. **Start everything:**
   ```bat
   npm run dev
   ```
   Open **http://localhost:5173**. The API runs on http://localhost:3000 (`/api/health` shows `"webSearch": "configured"` when the key is set).

`npm run db:check` tests the database connection.

### Pages

| Page | What it is for |
|---|---|
| **Home** | Search box with **INVESTIGATE WEB**, a short explanation and a small system overview |
| **Explore** | The results of an investigation: progress, summary, claim families, related sources, stored matches. Without a query it lists stored claim families |
| **Claim** (`/claims/:id`) | Metrics, source chronology, source table, Mutation Ledger, claim lineage, source lineage, fingerprint |
| **Sources** | Every stored source with filters for platform, retrieval method, known dependency and date, plus a details drawer |
| **Database Lab** | Schema, ER diagram, read-only example SQL, recent web search runs and background feed monitoring (**SYNC FEEDS**) |

---

## How an investigation works

1. **Oracle first.** Stored claim families that already match the query are shown alongside the new results.
2. **Tavily Search API** (one basic request) returns up to 20 results: title, URL, snippet, relevance score and, when available, a publication date. Google is not scraped, no browser automates a search engine, and nothing crawls the web.
3. **Normalise and deduplicate**: tracking parameters and fragments are removed; duplicates inside the batch and URLs already in `SOURCES` (URL, canonical URL or external id) are linked to the run instead of being stored twice.
4. **Fetch public pages**: 5 at a time, 9 s timeout, 1.5 MB limit, HTML only, `robots.txt` honoured, private network addresses refused. A page that cannot be fetched falls back to the search title and snippet.
5. **Extract** title, publisher, author, publication date, main text, canonical URL and outbound links. A field that cannot be found is stored as `NULL` and shown as *Not determined* — nothing is guessed.
6. **Analyse and store — one transaction per result**: insert the source, link it to the run, match it to a claim family (entities 40 · keywords 30 · location 10 · event 10 · date 5 · title 5; ≥ 75 strong, 55–74 candidate), choose the wording parent, insert the variant (the trigger writes the Mutation Ledger), record references and entities. A failure rolls back that result only.
7. **Relationship pass**: links between pages stored in the same run are resolved afterwards.

A result whose headline states nothing specific (no action, quantity or certainty) and matches no family is stored as a **related source** instead of being forced into a new claim. When no family gets two or more sources, Explore says **NO STRONG CLAIM FAMILY DETECTED**.

### Evidence rules

- **Known upstream source** (`SOURCES.derived_from_source_id`) is set only from explicit evidence: a hyperlink to a stored source in the same claim family, a submitted link (e.g. a Hacker News post), or manual/demo curation. Never from timing or text similarity alone.
- **Wording parent** (`CLAIM_VARIANTS.parent_variant_id`): the variant of an explicitly referenced source (*Explicit reference*); otherwise the most similar earlier version if its similarity is at least 55 (*Inferred predecessor*, drawn dashed); otherwise none. The earliest variant is never chosen just because it is the earliest.
- **Chronology** is ordered by `published_at` in Oracle; undated sources are listed last.
- Demonstration data keeps the curated wording *Independent / Derived / Echo Ratio* and is marked **DEMO**; everything else is marked **LIVE**.

---

## Database

| Script | Contents |
|---|---|
| `01_schema.sql` … `07_indexes.sql` | Core tables, constraints, views, PL/SQL, triggers, indexes |
| `03_seed.sql` | Synthetic demonstration data (15 claims, 75 sources) |
| `08_demo_queries.sql` | 37 commented read-only demonstration queries |
| `09_ingestion_support.sql` | Feed registry and ingestion procedures |
| `10_web_investigation.sql` | Live web investigation: `WEB_SEARCH_RUNS`, `SEARCH_RESULT_LINKS`, `SOURCE_REFERENCES`, nullable `published_at`, `canonical_url`, evidence-based lineage procedures, `VW_WEB_SEARCH_RUNS`, `VW_SOURCE_REFERENCES`. Safe to run again; it is also the migration for existing databases |
| `11_tavily_provider.sql` | Tavily as the web search provider: `search_provider` defaults become `TAVILY`. Keeps all existing rows; safe to run again |
| `install.sql` / `reset.sql` | Full install in order / drop everything |

With SQL*Plus instead of npm: `sqlplus afwaah/afwaah@localhost:1521/FREEPDB1 @install.sql` (fresh) or `@10_web_investigation.sql` then `@11_tavily_provider.sql` (upgrade), run from the `database` folder.

---

## Background monitoring

Feeds (two GDELT queries, Hacker News top stories and seven RSS/Atom feeds, configured in `INGESTION_SOURCES`) run every 60 minutes and once shortly after start. They use the same storage and matching code as web investigations. Status, last sync, failures and a **SYNC FEEDS** button are in the Database Lab. GDELT rate limits and feed timeouts are normal and are logged; stored data is unaffected.

---

## Configuration (`server/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DB_USER` / `DB_PASSWORD` / `DB_CONNECT_STRING` | `afwaah` / `afwaah` / `localhost:1521/FREEPDB1` | Oracle connection |
| `TAVILY_API_KEY` | *(empty)* | Enables live web search. Server-side only |
| `WEB_SEARCH_PROVIDER` | `tavily` | Web search provider |
| `WEB_SEARCH_MAX_RESULTS` | `20` | Results requested per investigation (max 20) |
| `WEB_FETCH_TIMEOUT_MS` / `WEB_FETCH_MAX_BYTES` / `WEB_FETCH_CONCURRENCY` | `9000` / `1500000` / `5` | Page fetching limits |
| `WEB_FETCH_RESPECT_ROBOTS` | `true` | Honour `robots.txt` |
| `INGESTION_ENABLED` / `INGESTION_INTERVAL_MINUTES` / `INGESTION_RUN_ON_START` | `true` / `60` / `true` | Background feeds |
| `MATCH_STRONG_THRESHOLD` / `MATCH_CANDIDATE_THRESHOLD` | `75` / `55` | Claim matching thresholds |
| `PORT` / `CORS_ORIGINS` | `3000` / `http://localhost:5173,…` | API |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"Live web search unavailable — showing stored sources."** | `TAVILY_API_KEY` is empty or wrong, or the Tavily rate or plan limit was reached. Check `server\.env` and restart `npm run dev`. |
| **"Oracle database disconnected"** | `docker start afwaah-oracle`, wait for *DATABASE IS READY TO USE!*, check `DB_CONNECT_STRING`. |
| `ORA-00942` table or view does not exist | The database predates live web investigation: run `npm run db:migrate`. |
| `ORA-01017` invalid username/password | `DB_USER` / `DB_PASSWORD` in `server\.env` do not match the database user. |
| Port 5173 or 3000 in use | Close the other process or change `PORT`. |
| Some pages show *date not determined* or the domain as publisher | The page could not be fetched or did not publish that metadata. This is expected. |

---

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — tiers, request flow, folders
- [`docs/database-design.md`](docs/database-design.md) — tables, constraints, PL/SQL, views, transactions
- [`docs/er-diagram.md`](docs/er-diagram.md) — ER diagram (Mermaid)
- [`docs/api.md`](docs/api.md) — REST endpoints
- [`docs/ingestion.md`](docs/ingestion.md) — web investigation, feeds, matching, lineage rules
