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

## Running it locally on Windows (Docker Desktop)

**Everyday use:** double-click `start-afwaahtracker.bat` in the project folder. It starts Docker Desktop, starts the Oracle container (and sets it to restart by itself whenever Docker starts), waits until Oracle accepts connections, then starts the site and opens http://localhost:5173. Close the window to stop the site. The steps below are the first-time setup and what the launcher does for you.

For a public server, see **[Public deployment (Ubuntu VPS)](#public-deployment-ubuntu-vps)**.

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

`npm run repair` upgrades live data stored by earlier versions (no reset, demo data untouched, safe to repeat). It recovers missing publication dates (date in the URL, else the page's own metadata), re-reads stored sources into evidence sentences and propositions, and moves sources out of old title-made families (left as **MERGED**). It then records attribution references and rebuilds lineage and the Mutation Ledger. `npm run repair -- --no-fetch` skips the page fetch.

`npm test` runs the deterministic extraction tests (no database needed). `npm run review-picks` lists, from your own Oracle data, the claim families that best show each analysis layer.

### What each analysis layer means

| Layer | Available when | Meaning |
|---|---|---|
| Evidence, canonical claim, structured variants | a claim is extracted | what the pages state |
| **Claim Variation** (`VW_CLAIM_VARIATION`) | 2+ versions | how the retrieved versions differ, without assuming order or copying |
| **Claim Lineage** | dated versions or a link/credit | defensible predecessor of each version |
| **Mutation Ledger** | parent–child links exist | structured changes along those links |
| **Stated provenance** (`SOURCE_ATTRIBUTIONS`) | a page credits someone ("according to Reuters") | every explicit credit, resolved or not |
| **Source Lineage** | a resolved credit or hyperlink | edges only for credits/links to a retrieved source |
| **Known Echo Ratio** | always | sources with a RESOLVED upstream ÷ all sources; unresolved credits never count |

Actions (impose, raise, cut, arrest, win, meet, deny … 41 predicates) come from one registry, `server/claims/lexicon.js`, shared by the query parser and the extractor.

`npm run investigate -- "Is GV Selvam director of VIT?"` runs one live investigation from the terminal and prints its Oracle diagnostics: every pipeline stage (examined / written), then sources, evidence, structured variants, parents, mutations, references and the Known Echo Ratio of each family found. `--run 42` or `--claim 305` prints the diagnostics of an earlier run or family.

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
6. **Hypothesis.** Before any result is analysed, a deterministic parser turns the query into a hypothesis (*Is GV Selvam director of VIT?* → `G. V. Selvam · HOLDS_ROLE · Director · VIT`) or marks it `TOPIC_SEARCH`. The hypothesis is never stored as a claim.
7. **Evidence → proposition → claim — one transaction per result**: insert the source and link it to the run; score its sentences against the hypothesis (entity aliases, role/relation words, query tokens; menus and boilerplate penalised) and store the best 1–3 in `SOURCE_EVIDENCE` (page sentence › meta description › search snippet › title); extract a structured proposition with rule-based patterns (roles, location, founded-by, membership, ownership, events with certainty/date/place); Oracle finds the claim family by `normalized_signature` (or creates one with `CREATE_PROPOSITION_CLAIM`); insert the variant pointing at its evidence (the trigger writes the Mutation Ledger); record hyperlink and *according to / via / citing* attribution references. A source with no extractable proposition stays a **related source**. A failure rolls back that result only.
8. **Provenance pass** over every source of the run (new and already stored): hyperlinks, canonical links and *according to / via / reported by / citing / source: X* credits that name a stored source in the same family become `SOURCE_REFERENCES`.
9. **`FINALISE_CLAIM_LINEAGE`** for each touched family: known upstream sources, then wording parents in publication order (link → credit → closest earlier dated version of the same proposition → none), then the Mutation Ledger, rebuilt from the final parents. `RECORD_SEARCH_CLAIM_MATCHES` relates the run to each family (`EXACT`, `DIFFERENT_VALUE`, `RELATED`, `TOPICAL`).
10. Every stage writes a `SEARCH_RUN_STAGES` row (items examined, rows written). `GET /api/web-search/:runId/novelty-diagnostics` therefore separates "0 detected" from "stage never ran".

Explore shows the investigated query next to what was found: e.g. *RELATED CLAIM FOUND — G. V. Selvam is Vice President of VIT* and *No retrieved source in this investigation directly supported the exact searched relationship.* No truth verdict is given.

### Evidence rules

- **Known upstream source** (`SOURCES.derived_from_source_id`) is set only from explicit evidence: a hyperlink to a stored source in the same claim family, a submitted link (e.g. a Hacker News post), or manual/demo curation. Never from timing or text similarity alone.
- **Wording parent** (`CLAIM_VARIANTS.parent_variant_id`): the variant of an explicitly referenced source (*Known reference*); otherwise the closest earlier version of the same proposition (*Inferred predecessor*); otherwise the most similar earlier version if its similarity is at least 55 (*Inferred predecessor*, drawn dashed); otherwise none. The earliest variant is never chosen just because it is the earliest.
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
| `PORT` / `CORS_ORIGINS` | `3000` / `http://localhost:5173,…` (empty in production) | API port and allowed cross-origin browser origins |
| `NODE_ENV` | `development` | `production` enables JSON logs, locks write endpoints and requires `DB_PASSWORD` |
| `ADMIN_TOKEN` | *(empty)* | Bearer token for write/admin endpoints (development without a token: open; production without a token: disabled) |
| `RATE_LIMIT_MAX` / `INVESTIGATE_RATE_MAX` / `INVESTIGATE_DAILY_LIMIT` | `300` / `10` / `100` | Requests per 15 min per IP / investigations per hour per IP / new web searches per day |

---

## Public deployment (Ubuntu VPS)

```
Internet ──80/443──▶ client  (Nginx: HTTPS, React build, /api proxy, rate limits)
                       │ network "web"
                     server  (Express API, Tavily search, feeds)
                       │ network "db"  (internal: no internet, no published ports)
                     oracle  (Oracle Database 23ai Free, data in volume "oracle-data")
```

Only Nginx publishes ports (80 and 443). Oracle's 1521 and the API's 3000 are reachable only inside Docker. Secrets live in `.env.production` on the server and never reach the browser or the images.

**What the public can do:** search, investigate (rate-limited), and read claims, sources, lineage and the Database Lab. Its example SQL is a fixed, read-only whitelist; arbitrary SQL is never accepted.
**What is locked:** creating, editing and deleting claims, variants and sources, and the feed sync (`POST /api/ingestion/refresh`). These return 403 unless you set `ADMIN_TOKEN`; then they accept `Authorization: Bearer <ADMIN_TOKEN>` (for example from `curl`). The SYNC FEEDS button is hidden on the public site; scheduled feeds keep running.

**Limits (per visitor IP, configurable in `.env.production`):** 300 API requests per 15 minutes; 10 web investigations per hour; at most 100 new web searches per day site-wide (`INVESTIGATE_DAILY_LIMIT`). Nginx adds a second limit in front of the API. The same query repeated within two minutes reuses the earlier result instead of spending another search credit.

### Requirements

- Ubuntu 22.04 or 24.04 VPS with **at least 4 GB RAM** (Oracle needs about 2 GB) and 20 GB disk
- A domain name with an **A record** pointing at the VPS IP address

### 1. Install Docker and open the firewall

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # then log out and back in
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Do not open port 1521 or 3000. The stack does not publish them.

### 2. Get the code and create the production settings

```bash
git clone https://github.com/hjgitscode/afwaahtracker.git
cd afwaahtracker
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Set at least:

| Variable | Value |
|---|---|
| `DOMAIN` | your domain, e.g. `afwaah.example.com` |
| `ORACLE_PASSWORD` | a long random password (Oracle administrator) |
| `DB_PASSWORD` | a different long random password (application user) |
| `TAVILY_API_KEY` | your Tavily key (empty = stored data and feeds only) |

Leave `CORS_ORIGINS` empty: the site and the API share one origin. Generate passwords with `openssl rand -base64 24`. Avoid the characters `$`, `` ` `` and quotes in passwords.

### 3. Start the stack (HTTP first)

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml logs -f server
```

The first start creates the Oracle database (a few minutes). The API then installs the AfwaahTracker schema and demonstration data automatically (`Database ready.` in the log). Later starts only apply the safe migrations, so data is never reset. Press Ctrl+C to stop following the log; the containers keep running.

Without a certificate Nginx serves plain HTTP, so `http://<your-domain>` works now.

### 4. Enable HTTPS (Let's Encrypt)

```bash
docker compose --env-file .env.production -f docker-compose.production.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot -d YOUR_DOMAIN --email YOU@EXAMPLE.COM --agree-tos --no-eff-email
docker compose --env-file .env.production -f docker-compose.production.yml restart client
```

Nginx detects the certificate on start, serves HTTPS on 443 and redirects HTTP to HTTPS (with HSTS).

Renew automatically (Let's Encrypt certificates last 90 days). Run `crontab -e` and add (adjust the path):

```
0 3 * * 1 cd /home/ubuntu/afwaahtracker && docker compose --env-file .env.production -f docker-compose.production.yml run --rm certbot renew --quiet && docker compose --env-file .env.production -f docker-compose.production.yml exec client nginx -s reload
```

### 5. Check it

```bash
curl -s https://YOUR_DOMAIN/api/health
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

`/api/health` returns `{"status":"ok","database":"up","webSearch":"configured",…}`, or HTTP 503 with `"database":"down"` while Oracle restarts. `ps` must list ports only for `client`.

### Operating it

| Task | Command (from the project folder) |
|---|---|
| Shorter commands | `alias afw='docker compose --env-file .env.production -f docker-compose.production.yml'` |
| Logs (JSON lines, secrets masked) | `afw logs -f server` · `afw logs -f client` |
| Update to a new version | `git pull && afw up -d --build` |
| Restart one service | `afw restart server` |
| Stop / start everything | `afw down` · `afw up -d` (data is kept in the `oracle-data` volume) |
| Back up Oracle data | `afw stop oracle && docker run --rm -v afwaahtracker_oracle-data:/d -v $PWD:/b alpine tar czf /b/oracle-data-$(date +%F).tgz -C /d . && afw start oracle` |
| Reset to demonstration data | `afw exec server node scripts/installDb.js` (deletes all stored investigations) |

Never run `afw down -v`: `-v` deletes the Oracle volume.

### Failure behaviour

| Situation | What visitors see |
|---|---|
| Tavily key missing, rejected, rate-limited or out of credits | The investigation finishes with "Live web search unavailable — showing stored sources." and the stored results |
| A public page cannot be fetched (blocked, timeout, not HTML) | The source is stored from its search title and snippet; the run is marked PARTIAL |
| Too many requests | HTTP 429 with a short explanation; the rest of the site keeps working |
| Oracle restarting | HTTP 503 "The database is temporarily unavailable"; the API reconnects automatically |
| API container restarting | Nginx answers `/api` with a 503 JSON message; the site itself stays up |

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
