# Automated ingestion

Nobody types sources in by hand. The backend fetches **public, structured** sources on a schedule, and whenever **REFRESH DATA** is pressed.

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
4. **Provenance:** if the item's submitted link equals a stored `source_url`, the new source is marked `derived_from_source_id = <that source>` with a provenance note. Nothing else is inferred.
5. **Analyse, deterministically:**
   - *Entities:* whole-word phrase matching of every `ENTITY_ALIASES` entry against the normalised headline. Short all-capital aliases (VIT, WHO, AI, EU) are matched case-sensitively.
   - *Keywords:* known `KEYWORDS` present in the headline (singular/plural tolerant).
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
   | Date/time context | 5 | within 7 days of the claim's latest source (3 if within 30) |
   | Title similarity | 5 | Jaro-Winkler ÷ 100 × 5 |

   - **≥ 75** (`MATCH_STRONG_THRESHOLD`): strong automatic match, attached as a variant (`RULE_STRONG`)
   - **55–74** (`MATCH_CANDIDATE_THRESHOLD`): candidate match, attached and flagged (`RULE_CANDIDATE`)
   - **< 55:** a new claim with status `CANDIDATE`, plus a fingerprint where only `core_assertion` and `source_pattern` are filled. Sentiment, emotional hook and manipulation marker stay NULL and the UI shows "NOT YET CURATED".

   `match_score`, `match_method` and a human-readable `match_breakdown` are stored on the variant.
7. **Store:** `ADD_CLAIM_VARIANT` inserts the variant. For matched items the parent is the claim's earliest variant (`lineage_basis = AUTO_ROOT`), so the compound trigger writes the Mutation Ledger. Entities and keywords are linked through `MERGE` procedures. Steps 3–7 are **one transaction**.
8. **Log:** `FINISH_INGESTION_RUN` records fetched, inserted, skipped and matched counts plus a status (`SUCCESS`, `PARTIAL`, `FAILED`) and a readable error message. A trigger stamps `last_fetched_at`.

This is **deterministic rule-based claim matching**. It does not understand language and does not pretend to.

## Offline behaviour

If a feed cannot be reached (no internet, DNS failure, timeout, HTTP error, malformed feed), that run is logged as `FAILED` with a readable message, the remaining feeds still run, and the application keeps serving everything already in Oracle.
