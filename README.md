# AfwaahTracker

**Trace the claim. Trace the source. See what changed.**

AfwaahTracker is a claim-centric source investigation tool built on Oracle Database. Search for a statement, person, place, organisation or event and it returns the underlying claim family: every known version of the wording, who published it, where, when, which sources are known to derive from which (source lineage), how the wording drifted (claim lineage), a structured **Mutation Ledger**, and the **Echo Ratio**: the share of sources that derive from an earlier known source.

> Echo Ratio measures source dependence, not truthfulness.

```
React + Vite (localhost:5173)  ──HTTP/REST──▶  Node + Express (localhost:3000)  ──node-oracledb pool──▶  Oracle Database Free / XE (1521)
                                                        │
                                                        └── node-cron ingestion: GDELT · Hacker News · RSS/Atom
```

The browser never connects to Oracle. Credentials live only in `server/.env`, and every statement uses bind variables.

---

## Contents

| Path | What it is |
|---|---|
| `database/` | SQL*Plus-compatible Oracle scripts: schema, constraints, seed, views, PL/SQL, triggers, indexes, 32 demonstration queries, ingestion support, `install.sql`, `reset.sql` |
| `server/` | Express REST API, connection pool, ingestion adapters, scheduler, rule-based matcher |
| `client/` | React + Vite + Tailwind front end (Geist, Lucide, Recharts, React Flow) |
| `docs/` | Architecture, database design, ER diagram, API reference, ingestion pipeline |
| `setup-database.bat` | One-step Windows database setup with SQL*Plus |
| `start-afwaahtracker.bat` | Installs dependencies on first run and starts both servers |

---

## Prerequisites (Windows)

1. **Node.js 18.18 or newer** (20 LTS or 22 LTS recommended) with npm: <https://nodejs.org>
2. **Oracle Database 23ai Free** (recommended) or **Oracle Database 21c XE**
   - Free: service name `FREEPDB1`
   - XE 21c: service name `XEPDB1`
   - Note the password you chose for `SYSTEM` during installation.
3. **SQL*Plus**. It is installed with Oracle Database Free/XE. Check with `sqlplus -V` in a new Command Prompt.
   *No SQL*Plus? Use `npm run db:install` instead (step 3b).*

node-oracledb runs in **Thin mode**, so you do not need Oracle Instant Client.

---

## Setup

Open **Command Prompt** or **PowerShell** in the project folder (the folder that holds this README).

### 1. Check that Oracle is running

The Oracle Windows service (`OracleServiceFREE` or `OracleServiceXE`) must be running. Check it in *services.msc*, or try:

```bat
sqlplus system/YOUR_SYSTEM_PASSWORD@localhost:1521/FREEPDB1
```

Type `exit` to leave. On XE, replace `FREEPDB1` with `XEPDB1` in every command below.

### 2. Create the database user

```bat
cd database
sqlplus system/YOUR_SYSTEM_PASSWORD@localhost:1521/FREEPDB1 @00_create_user.sql
cd ..
```

This creates the user `afwaah` with password `afwaah` and the privileges it needs. To use a different password, edit `00_create_user.sql` first and use the same password in `server/.env`.

### 3. Install the schema and data

**3a. With SQL*Plus (recommended):**

```bat
cd database
sqlplus afwaah/afwaah@localhost:1521/FREEPDB1 @install.sql
cd ..
```

`install.sql` runs `reset.sql` and then `01_schema`, `02_constraints`, `07_indexes`, `05_procedures`, `06_triggers`, `03_seed`, `09_ingestion_support` and `04_views`, in that order. It ends by printing an object summary. Every object should be `VALID`, and the data should come to 15 claims, 75 sources and 169 Mutation Ledger rows. You can run it again at any time to reset the database to the demonstration state.

> Shortcut: `setup-database.bat YOUR_SYSTEM_PASSWORD FREEPDB1` runs steps 2 and 3a in one go.

**3b. Without SQL*Plus:** complete steps 2 (any SQL tool connected as SYSTEM can run the `CREATE USER` / `GRANT` lines) and 4, then run:

```bat
npm run install-all
npm run db:install
```

### 4. Configure the server

```bat
copy server\.env.example server\.env
```

Edit `server\.env` if your settings differ:

```ini
DB_USER=afwaah
DB_PASSWORD=afwaah
DB_CONNECT_STRING=localhost:1521/FREEPDB1     # XE: localhost:1521/XEPDB1
```

### 5. Install the npm packages

```bat
npm run install-all
```

### 6 and 7. Start the backend and frontend

```bat
npm run dev
```

This starts both servers together:

- Frontend: **http://localhost:5173**
- Backend: **http://localhost:3000** (health check: <http://localhost:3000/api/health>)

To run them separately in two terminals, use `npm run server` and `npm run client`.
`start-afwaahtracker.bat` does steps 4–7 in one go and opens the browser.

Check the database connection with `npm run db:check`.

---

## Try it

1. Open <http://localhost:5173>.
2. Search **`Aakash Gupta VIT`** and press **INVESTIGATE**.
3. On the claim card, press **INVESTIGATE CLAIM**.
4. The investigation page shows the canonical claim, the Echo Ratio (75%, high repetition), the claim fingerprint, entities and keywords, the source table with publishers, platforms and *View source ↗* links, the two lineage graphs, a timeline, and the Mutation Ledger. The ledger includes **CERTAINTY Possible → Confirmed**, **ACTION Visit → Perform** and **EVENT NULL → Vibrance**.

> "Aakash Gupta will perform at VIT" and every other seeded claim is **synthetic demonstration data**. Its sources use `.example` URLs and publishers marked "(demo)". It does not describe a real event.

Press **REFRESH DATA** (top right) or **REFRESH NOW** on *Live Feed* to fetch every enabled feed immediately. New sources are deduplicated and matched to claim families automatically. If the internet is unavailable, the run is logged as FAILED and the application keeps working with the data already stored in Oracle.

---

## Automated ingestion

- On startup the backend schedules ingestion with node-cron (default every 60 minutes, `INGESTION_INTERVAL_MINUTES`). With `INGESTION_RUN_ON_START=true` it also runs about 8 seconds after start.
- The sources are configured in the `INGESTION_SOURCES` table: two GDELT DOC API queries, the Hacker News top stories, and RSS/Atom feeds (BBC Technology, BBC Science, The Hindu Education, NASA, WHO, ScienceDaily, plus Ars Technica, which is disabled by default). To add a feed, insert a row with `source_type = 'RSS'`. No code change is needed.
- Every run writes an `INGESTION_LOG` row with the counts fetched, inserted, skipped and matched.
- `npm run ingest` runs a one-off ingestion from the command line.

Claim matching is **deterministic and rule-based**. It uses no AI, machine learning or embeddings. See [`docs/ingestion.md`](docs/ingestion.md).

---

## Configuration reference (`server/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DB_USER` / `DB_PASSWORD` | `afwaah` / `afwaah` | Application schema |
| `DB_CONNECT_STRING` | `localhost:1521/FREEPDB1` | Easy Connect string |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `1` / `8` | Connection pool size |
| `PORT` | `3000` | API port |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Allowed browser origins |
| `INGESTION_ENABLED` | `true` | Turn the scheduler on or off |
| `INGESTION_INTERVAL_MINUTES` | `60` | Scheduler tick |
| `INGESTION_RUN_ON_START` | `true` | Run once shortly after startup |
| `INGESTION_TIMEOUT_MS` | `15000` | Per-request timeout |
| `MATCH_STRONG_THRESHOLD` | `75` | Score that counts as a strong automatic match |
| `MATCH_CANDIDATE_THRESHOLD` | `55` | Score that counts as a candidate match |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI shows **"Oracle database disconnected"** | Start the Oracle service and check `DB_CONNECT_STRING` (FREEPDB1 or XEPDB1). The API reconnects automatically. |
| UI shows **"API not reachable"** | The backend is not running. Start it with `npm run dev` and look at the `[api]` output. |
| `ORA-01017` invalid username/password | The user or password in `server/.env` does not match `00_create_user.sql`. |
| `ORA-12514` listener does not know of service | Wrong service name. Use `FREEPDB1` (Free) or `XEPDB1` (XE). |
| `ORA-01950` no privileges on tablespace | Re-run `00_create_user.sql` as SYSTEM. It grants `QUOTA UNLIMITED ON users`. |
| Port 5173 or 3000 already in use | Close the other process, or change `PORT` and the Vite proxy (`VITE_API_PROXY`). |
| Feeds show **FAILED** on Live Feed | No internet access, or the remote service is down or rate-limiting (GDELT allows about one request every 5 s). Stored data is unaffected. |

---

## Documentation

- [`docs/architecture.md`](docs/architecture.md): tiers, request flow, folder layout
- [`docs/database-design.md`](docs/database-design.md): tables, constraints, normalisation, PL/SQL, views, indexes, transactions
- [`docs/er-diagram.md`](docs/er-diagram.md): ER diagram (Mermaid)
- [`docs/api.md`](docs/api.md): REST endpoints
- [`docs/ingestion.md`](docs/ingestion.md): adapters, deduplication, matching, scheduler
- `database/08_demo_queries.sql`: 32 commented demonstration queries
