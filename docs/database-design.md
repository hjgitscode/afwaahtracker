# Database design

All objects live in one schema (`AFWAAH`). Scripts are SQL*Plus compatible. `database/install.sql` runs them in dependency order.

## Tables (22)

| Table | Purpose | Key relationships |
|---|---|---|
| `PLATFORMS` | Where content appears (news site, forum, social …) | parent of SOURCES, INGESTION_SOURCES |
| `CATEGORIES` | Claim categories | parent of CLAIMS, INGESTION_SOURCES |
| `INGESTION_SOURCES` | Registry of automated feeds (GDELT / HACKER_NEWS / RSS) | FK platform, default category |
| `INGESTION_LOG` | One row per ingestion run | FK ingestion source (CASCADE) |
| `SOURCES` | Every stored article, post, story or forward | FK platform, ingestion source; **self-FK `derived_from_source_id`** |
| `CLAIMS` | Canonical claim families | FK category |
| `CLAIM_VARIANTS` | One structured version of a claim in one source | FK claim, source; **self-FK `parent_variant_id`** |
| `ENTITIES` | Dictionary of people, organisations, locations, events and topics | |
| `ENTITY_ALIASES` | Alternative names (1:N) | FK entity |
| `CLAIM_ENTITIES` | M:N claims ↔ entities | composite PK |
| `ENTITY_CANDIDATES` | Unknown capitalised phrases seen during ingestion (type not guessed) | FK first source |
| `KEYWORDS` | Keyword dictionary (CURATED / AUTO) | |
| `CLAIM_KEYWORDS` | M:N claims ↔ keywords, with weight | composite PK |
| `FINGERPRINTS` | Structured signature, 1:1 with a claim | UNIQUE FK claim |
| `CLAIM_MUTATIONS` | Mutation Ledger: one row per changed component | FK claim, parent and child variant |
| `AUDIT_LOG` | Trigger-written audit trail | |
| `WEB_SEARCH_RUNS` | One row per live web investigation, with its counts and status | |
| `SEARCH_RESULT_LINKS` | M:N search runs ↔ sources, with rank, provider, snippet | composite PK, FK run and source (CASCADE) |
| `SOURCE_REFERENCES` | Explicit evidence that one stored source points at another (`HYPERLINK`, `SUBMITTED_LINK`, `CANONICAL_REFERENCE`, `ATTRIBUTION`, `MANUAL`) | FK from/to source; UNIQUE (from, to, type) |
| `SOURCE_EVIDENCE` | The 1–3 sentences of a source that state something about the investigated claim (`PAGE_SENTENCE` › `META_DESCRIPTION` › `SEARCH_SNIPPET` › `TITLE_FALLBACK`) | FK source, search run; UNIQUE (source, sentence hash) |
| `CLAIM_PROPOSITIONS` | Structured proposition of a claim family: subject · predicate · object · qualifier · temporal scope | PK/FK claim; FK subject/object/qualifier entity; UNIQUE `normalized_signature` |
| `SEARCH_CLAIM_MATCHES` | M:N search runs ↔ claim families: `EXACT`, `DIFFERENT_VALUE`, `RELATED`, `TOPICAL`, with evidence and source counts | composite PK, FK run and claim |

`CLAIM_VARIANTS` also carries `evidence_id` (FK `SOURCE_EVIDENCE`), `relation_subject / predicate / object / qualifier` and `extraction_basis`; `WEB_SEARCH_RUNS` stores the parsed query hypothesis (`query_type`, `hypothesis_*`). Signature: `SUBJECT_KEY|PREDICATE|OBJECT_KEY|QUALIFIER_KEY|TEMPORAL`, where entity keys are `E<entity_id>` and a role is its code (`VICE_PRESIDENT`), so *Director* and *Vice President* never collide.

`SOURCES.published_at` is nullable: an unknown publication date is stored as `NULL`, never guessed. `SOURCES.canonical_url` holds a page's canonical URL when it differs. `origin_type` is `DEMO`, `AUTOMATED` (feeds), `WEB_SEARCH` or `MANUAL`.

## Integrity

- **Entity integrity:** every table has a primary key (`IDENTITY` surrogate keys, or composite keys on the junction tables).
- **Referential integrity:** 20 foreign keys with explicit delete rules. Deleting a claim cascades to its variants, mutations, links and fingerprint. A deleted source sets `derived_from_source_id` in its children to NULL.
- **Domain integrity:** `CHECK` constraints on every enumerated column (status, certainty, platform type, changed component …), on counts (≥ 0), on scores (0–100), on URL format (`REGEXP_LIKE`), on lower-case keywords, and against self-reference (`derived_from_source_id <> source_id`). `NOT NULL` and `DEFAULT` are used throughout.
- **Uniqueness:** `UQ_SOURCES_URL` on `source_url`. The function-based unique index `UX_SOURCES_EXTERNAL` on `(CASE WHEN external_source_id IS NOT NULL THEN platform_id END, external_source_id)` makes an external id unique per platform while rows without one are not indexed. A plain composite UNIQUE constraint would treat every NULL-id row on the same platform as a duplicate.

## Normalisation (about 3NF)

- 1NF: atomic values only. Aliases and keywords are rows, never comma-separated lists.
- 2NF: the junction tables hold only attributes of their whole composite key (`detected_by`, `weight`).
- 3NF: platform, category and entity attributes are stored once. Derived values such as source counts, first and latest seen, and Echo Ratio are **computed in views**, never stored.

## PL/SQL

| Object | Type | What it does |
|---|---|---|
| `CALCULATE_ECHO_RATIO(claim_id)` | function | derived sources ÷ total sources × 100 (rounded to 0.1) |
| `ECHO_BAND(ratio)` | function | MOSTLY INDEPENDENT (0–30) / MIXED (31–60) / HIGH REPETITION (61–80) / VERY HIGH SOURCE DEPENDENCE (81–100) |
| `CERTAINTY_RANK(certainty)` | function | ordinal scale used to flag certainty escalation |
| `GENERATE_MUTATION_LEDGER(parent, child)` | procedure | compares ACTOR, ACTION, TARGET, LOCATION, EVENT, DATE, QUANTITY, CERTAINTY and ATTRIBUTION and inserts one row per difference. It is idempotent and flags an escalation when certainty rises by two or more steps (e.g. Possible → Confirmed) |
| `REBUILD_CLAIM_MUTATIONS(claim_id)` | procedure | regenerates a whole claim's ledger |
| `ADD_CLAIM_VARIANT(...)` | procedure | validated insert inside a SAVEPOINT, with exception handling |
| `WRITE_AUDIT(...)` | procedure | shared audit writer |
| `INGEST_SOURCE(...)` | function | deduplicated insert. Returns 0 for a duplicate and records deterministic provenance from `linked_url` |
| `START_INGESTION_RUN` / `FINISH_INGESTION_RUN` | function / procedure | open and close `INGESTION_LOG` rows |
| `LINK_CLAIM_ENTITY`, `LINK_CLAIM_KEYWORD`, `RECORD_ENTITY_CANDIDATE` | procedures | `MERGE`-based upserts |
| `FIND_SOURCE_ID(url, canonical, platform, external_id)` | function | duplicate lookup used before fetching and storing |
| `START_WEB_SEARCH_RUN` / `FINISH_WEB_SEARCH_RUN` | function / procedure | open and close `WEB_SEARCH_RUNS` rows |
| `RECORD_SEARCH_RESULT_LINK`, `RECORD_SOURCE_REFERENCE` | procedure / function | `MERGE`-based links between runs, sources and evidence |
| `WORDING_SIMILARITY(a, b)` | function | deterministic 0–100 similarity (word overlap + Jaro-Winkler) |
| `CHOOSE_VARIANT_PARENT(...)` | procedure | explicit reference › inferred lexical predecessor › none |
| `APPLY_SOURCE_DEPENDENCE(source_id)` | function | sets `derived_from_source_id` only from explicit references within the same claim family |
| `RELINK_CLAIM_LINEAGE(claim_id)` | procedure | recomputes automatic wording parents (used by the migration) |

## Triggers

| Trigger | Timing | Purpose |
|---|---|---|
| `TRG_VARIANTS_MUTATIONS` | compound, INSERT/UPDATE on CLAIM_VARIANTS | calls `GENERATE_MUTATION_LEDGER` after the statement. The compound form avoids ORA-04091 (mutating table) and also refreshes a changed variant's children |
| `TRG_CLAIMS_AUDIT`, `TRG_SOURCES_AUDIT`, `TRG_VARIANTS_AUDIT` | AFTER row | audit trail |
| `TRG_CLAIMS_TOUCH` | BEFORE UPDATE row | maintains `updated_at` |
| `TRG_KEYWORDS_NORMALISE` | BEFORE INSERT/UPDATE row | lower-cases and trims keywords |
| `TRG_INGESTION_LOG_COMPLETE` | AFTER UPDATE OF status | stamps `INGESTION_SOURCES.last_fetched_at` |

## Views

- `VW_CLAIM_OVERVIEW`: claim_id, canonical_claim, category, status, first_seen, latest_seen, number_of_sources, number_of_platforms, number_of_variants, number_of_independent_origins, number_of_derived_sources, echo_ratio, echo_band
- `VW_CLAIM_SOURCES`: variant + source + platform + upstream publisher (self-join)
- `VW_PLATFORM_STATISTICS`: per-platform counts and engagement
- `VW_SOURCE_LINEAGE`: hierarchical (`CONNECT BY`) root, depth and path for every source
- `VW_RECENT_CLAIMS`: the 20 most recently active claim families
- `VW_INGESTION_STATUS`: registry plus the latest run (analytic `ROW_NUMBER`)
- `VW_WEB_SEARCH_RUNS`: each run with its duration, linked sources and claim-family count
- `VW_SOURCE_REFERENCES`: references with both publishers and whether the reference set source dependence

## Indexes

There are 26 explicit indexes: B-tree indexes on every foreign-key column (including `SEARCH_RESULT_LINKS.source_id` and `SOURCE_REFERENCES.to_source_id`), on frequent filters (`published_at`, `(origin_type, fetched_at)`, `status`, `WEB_SEARCH_RUNS.started_at`, `canonical_url`), function-based indexes for case-insensitive search (`LOWER(canonical_claim)`, `LOWER(publisher)`, `LOWER(source_title)`, `LOWER(entity_name)`, `LOWER(alias_text)`), and the function-based unique index for external ids. Constraints add further indexes for primary and unique keys (58 in total).

## Transactions

- Every ingested feed item and every web search result is one transaction (source → run link → references → claim/fingerprint → variant → ledger → dependence → entity and keyword links). A failure rolls back that item only.
- `ADD_CLAIM_VARIANT` uses `SAVEPOINT` and `ROLLBACK TO SAVEPOINT`.
- The seed loads as one transaction and ends with `COMMIT`.
- Audit rows are written in the caller's transaction, so a rollback leaves no orphaned audit entries.
- `08_demo_queries.sql` Q31 demonstrates `SAVEPOINT` / `ROLLBACK`.

## Echo Ratio

```
Echo Ratio = derived sources / total sources × 100
```

A source is *derived* when `SOURCES.derived_from_source_id` is known. Demonstration data states its dependencies explicitly. Live data only gets a parent from explicit evidence: a hyperlink to a stored source in the same claim family, or a submitted link that matches a stored URL. Publication order and text similarity alone are never treated as evidence of copying. For live data the UI therefore says **Known Echo Ratio**, **Known derived** and **No known upstream source**.

Known Echo Ratio measures detected source dependence among retrieved sources. It does not prove that sources without a known parent are independent, and it does not measure truthfulness.

## Seed dataset

The seed holds 15 claim families in 8 categories, 75 sources on 10 platforms, 75 variants, 32 curated entities (51 with the ingestion dictionary) and 72+ aliases, 49 keywords, 15 curated fingerprints, at least 5 multi-level source-lineage chains (claims 1, 2, 3, 4, 8), at least 5 mutation chains (claims 1, 2, 3, 6, 8), and 169 generated ledger rows. All of it is clearly labelled synthetic demonstration data using `.example` URLs.
