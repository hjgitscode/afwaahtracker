# Web investigation and background feeds

AfwaahTracker collects sources in two modes that share one storage and matching path (`server/ingestion/sourceProcessor.js`):

- **Live web investigation** (on demand, **INVESTIGATE WEB**): Tavily Search API → public pages → rule-based analysis → Oracle.
- **Background monitoring** (scheduled, or **SYNC FEEDS** in the Database Lab): GDELT, Hacker News and RSS/Atom feeds.

## Live web investigation (`server/web-search/`)

| Module | Role |
|---|---|
| `searchProvider.js` | `searchWeb(query)`: the only entry point the pipeline uses; `WEB_SEARCH_PROVIDER` picks the adapter |
| `tavilySearch.js` | Tavily Search API, `search_depth: basic`, one request per investigation, `max_results` from `WEB_SEARCH_MAX_RESULTS` (≤ 20). Maps results to `{ rank, title, url, snippet, domain, publisher (hostname), publishedAt (only if supplied), score, provider: 'TAVILY' }`. Key read only from `server/.env`; invalid key, rate/plan limits, timeouts and malformed responses become friendly messages |
| `pageFetcher.js` | 5 concurrent fetches, 9 s timeout, 1.5 MB limit, HTML only, `robots.txt` honoured, redirects followed manually, private and loopback addresses refused. Failures never abort the run |
| `pageExtractor.js` | cheerio: title (og:title › JSON-LD headline › h1 › title), publisher (og:site_name › JSON-LD publisher), author, published date (article:published_time › JSON-LD datePublished › meta date › `<time>`), canonical URL, main paragraphs. Missing → `NULL` |
| `referenceExtractor.js` | Outbound links of the article body, normalised like stored URLs |
| `webInvestigator.js` | Orchestrates one run and reports its stage for the progress panel. The same query repeated within two minutes reuses the earlier run (no second search request) |

Run steps: `START_WEB_SEARCH_RUN` → search → normalise URLs and drop in-batch duplicates → `FIND_SOURCE_ID` links already stored sources to the run → fetch and extract new pages (fallback: search title + snippet) → **one transaction per result** (`INGEST_SOURCE` with origin `WEB_SEARCH`, `RECORD_SEARCH_RESULT_LINK`, references, matching, `CHOOSE_VARIANT_PARENT`, `ADD_CLAIM_VARIANT`, `APPLY_SOURCE_DEPENDENCE`, entity/keyword links) → relationship pass for links between pages stored in the same run → `FINISH_WEB_SEARCH_RUN` (`SUCCESS`, `PARTIAL` when some pages failed, `FAILED` when the search itself failed).

Web results must carry a claim signal before they may start a new claim family: an action verb, a quantity or a stated certainty, plus a dictionary entity or three significant words. Otherwise they are stored as related sources only. Candidate matches (55–74) are attached but do not add entities or keywords to the claim, so loosely related results cannot gradually widen a family.

## Evidence-based lineage

| What | Rule |
|---|---|
| `SOURCE_REFERENCES` | `HYPERLINK` (an outbound link equals a stored source URL), `SUBMITTED_LINK` (a feed item's submitted link), `CANONICAL_REFERENCE` (canonical URL is another stored source), `MANUAL`. Topical similarity never creates a row |
| Known upstream source | `APPLY_SOURCE_DEPENDENCE` sets `derived_from_source_id` only when a referenced source is in the same claim family; earliest referenced source wins; cycles refused |
| Wording parent | `CHOOSE_VARIANT_PARENT`: explicit reference → `EXPLICIT_REFERENCE`; else the most similar strictly earlier variant with `WORDING_SIMILARITY` ≥ 55 → `LEXICAL_PREDECESSOR` (shown as *Inferred predecessor*); else none. `WORDING_SIMILARITY` = 70 % word-overlap coefficient + 30 % `UTL_MATCH.JARO_WINKLER_SIMILARITY` |
| Existing data | `RELINK_CLAIM_LINEAGE` replaces the old "attach everything to the earliest variant" (`AUTO_ROOT`) links during migration; curated and manual lineage is never touched |

## Adapters (`server/ingestion/`)

| Adapter | Endpoint | Fields used |
|---|---|---|
| `gdelt.js` | GDELT DOC 2.0 API (`mode=artlist&format=json`) | title, URL, domain → publisher, `seendate` → published, source country |
| `hackerNews.js` | Official Firebase API: `topstories.json`, then `item/<id>.json` | id → external id, title, author, time, score + comments → engagement, submitted URL → `linked_url` |
| `rss.js` | Any RSS 2.0 / Atom feed (`rss-parser`) | title, link, pubDate/isoDate, author, content snippet, feed title → publisher |

Instagram, Facebook, X, private or login-protected sites are **not** scraped. To support another structured API later, add an adapter and a new `source_type` value.

## Registry

`INGESTION_SOURCES` holds the feeds: name, type, endpoint, platform, default category, enabled flag, `fetch_interval_minutes`, `max_items` and `last_fetched_at`. To add a feed:

```sql
INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id)
VALUES ('My feed', 'RSS', 'https://example.org/feed.xml',
        (SELECT platform_id FROM platforms WHERE platform_name = 'News Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Technology'));
COMMIT;
```

## Scheduler

`scheduler.js` uses node-cron. Every `INGESTION_INTERVAL_MINUTES` (default 60) it runs every enabled source whose own `fetch_interval_minutes` has elapsed. `POST /api/ingestion/refresh` forces all enabled sources. Only one run happens at a time: a manual refresh during a scheduled run joins it. GDELT requests are spaced about 5.5 s apart.

## Pipeline for each item (`pipeline.js`)

1. **Normalise** (`normalizer.js`): strip HTML and entities, collapse whitespace, normalise the URL (lower-case host, drop fragment and `utm_*`, `fbclid`, `gclid` …, drop the trailing slash), parse the date and clamp future dates.
2. **Deduplicate in the batch:** the same URL twice in one response is skipped.
3. **Deduplicate in Oracle:** `INGEST_SOURCE` checks `source_url` (unique index) and `(platform, external_source_id)` (function-based unique index), and catches `DUP_VAL_ON_INDEX` for races. It returns 0, which the pipeline counts as *skipped*. Rows are never loaded into JavaScript for comparison.
4. **Provenance:** if the item's submitted link equals a stored `source_url`, the new source is marked `derived_from_source_id = <that source>` and a `SUBMITTED_LINK` row is written to `SOURCE_REFERENCES`. Nothing else is inferred.
5. **Analyse, deterministically:**
   - *Entities:* whole-word phrase matching of every `ENTITY_ALIASES` entry against the normalised headline. Short all-capital aliases (VIT, WHO, AI, EU) are matched case-sensitively.
   - *Keywords:* known `KEYWORDS` present in the headline (regular inflections tolerated: -s, -es, -ed, -ing).
   - *Certainty:* fixed vocabularies (denies/false → DENIED, "?" → QUESTIONED, confirmed/official → CONFIRMED, will/expected → EXPECTED, may/might/reportedly → POSSIBLE).
   - *Action:* a small verb dictionary (visit, perform, launch, ban, cancel, postpone …).
   - *Quantity:* the first number with a unit.
   - *Entity candidates:* capitalised 2–4-word phrases not in the dictionary go to `ENTITY_CANDIDATES`. Their type is not guessed.
6. **Match:** Oracle returns every claim sharing an entity or keyword, with overlap counts and `UTL_MATCH.JARO_WINKLER_SIMILARITY` between the headline and the canonical claim. The score is then:

   | Component | Weight | Rule |
   |---|---|---|
   | Entity overlap | 40 | shared entities ÷ size of the smaller entity set |
   | Keyword overlap | 30 | shared keywords ÷ size of the smaller keyword set |
   | Location match | 10 | a shared LOCATION entity |
   | Event match | 10 | a shared EVENT entity |
   | Date/time context | 5 | within 7 days of the claim's latest source (3 if within 30); 0 when the date is unknown |
   | Title similarity | 5 | Jaro-Winkler ÷ 100 × 5 |

   - **≥ 75** (`MATCH_STRONG_THRESHOLD`): strong automatic match, attached as a variant (`RULE_STRONG`)
   - **55–74** (`MATCH_CANDIDATE_THRESHOLD`): candidate match, attached and flagged (`RULE_CANDIDATE`)
   - **< 55:** a new claim with status `CANDIDATE`, plus a fingerprint where only `core_assertion` and `source_pattern` are filled. Sentiment, emotional hook and manipulation marker stay NULL and the UI shows "NOT DETERMINED".

   `match_score`, `match_method` and a human-readable `match_breakdown` are stored on the variant.
7. **Store:** `CHOOSE_VARIANT_PARENT` picks the wording parent (see *Evidence-based lineage*), `ADD_CLAIM_VARIANT` inserts the variant and the compound trigger writes the Mutation Ledger. Entities and keywords are linked through `MERGE` procedures. Steps 3–7 are **one transaction**.
8. **Log:** `FINISH_INGESTION_RUN` records fetched, inserted, skipped and matched counts plus a status (`SUCCESS`, `PARTIAL`, `FAILED`) and a readable error message. A trigger stamps `last_fetched_at`.

This is **deterministic rule-based claim matching**. It does not understand language and does not pretend to.

## Offline behaviour

If a feed cannot be reached (no internet, DNS failure, timeout, HTTP error, malformed feed), that run is logged as `FAILED` with a readable message, the remaining feeds still run, and the application keeps serving everything already in Oracle.
