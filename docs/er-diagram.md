# ER diagram

The Database Lab page renders an interactive version of this diagram. Below is the same model in Mermaid syntax, which GitHub and many Markdown viewers render.

```mermaid
erDiagram
    PLATFORMS ||--o{ SOURCES : "hosts"
    PLATFORMS ||--o{ INGESTION_SOURCES : "feeds into"
    CATEGORIES ||--o{ CLAIMS : "classifies"
    CATEGORIES ||--o{ INGESTION_SOURCES : "default for"
    INGESTION_SOURCES ||--o{ INGESTION_LOG : "runs"
    INGESTION_SOURCES ||--o{ SOURCES : "collected"
    SOURCES ||--o{ SOURCES : "derived_from_source_id"
    SOURCES ||--o{ CLAIM_VARIANTS : "carries"
    SOURCES ||--o{ ENTITY_CANDIDATES : "first seen in"
    CLAIMS ||--o{ CLAIM_VARIANTS : "has versions"
    CLAIM_VARIANTS ||--o{ CLAIM_VARIANTS : "parent_variant_id"
    CLAIMS ||--|| FINGERPRINTS : "signature"
    CLAIMS ||--o{ CLAIM_MUTATIONS : "ledger"
    CLAIM_VARIANTS ||--o{ CLAIM_MUTATIONS : "parent / child"
    CLAIMS ||--o{ CLAIM_ENTITIES : ""
    ENTITIES ||--o{ CLAIM_ENTITIES : ""
    ENTITIES ||--o{ ENTITY_ALIASES : "also known as"
    CLAIMS ||--o{ CLAIM_KEYWORDS : ""
    KEYWORDS ||--o{ CLAIM_KEYWORDS : ""
    WEB_SEARCH_RUNS ||--o{ SEARCH_RESULT_LINKS : "returned"
    SOURCES ||--o{ SEARCH_RESULT_LINKS : "found by"
    SOURCES ||--o{ SOURCE_REFERENCES : "from_source_id"
    SOURCES ||--o{ SOURCE_REFERENCES : "to_source_id"

    PLATFORMS { number platform_id PK  varchar platform_name UK  varchar platform_type }
    CATEGORIES { number category_id PK  varchar category_name UK }
    INGESTION_SOURCES { number ingestion_source_id PK  varchar source_name UK  varchar source_type  varchar endpoint_url  number platform_id FK  number default_category_id FK  char enabled  number fetch_interval_minutes  timestamp last_fetched_at }
    INGESTION_LOG { number log_id PK  number ingestion_source_id FK  timestamp started_at  timestamp completed_at  number records_fetched  number records_inserted  number records_skipped  varchar status  varchar error_message }
    SOURCES { number source_id PK  number platform_id FK  number ingestion_source_id FK  varchar publisher  varchar source_title  varchar source_url UK  varchar canonical_url  varchar external_source_id  timestamp published_at  varchar source_status  varchar origin_type  number derived_from_source_id FK }
    CLAIMS { number claim_id PK  varchar canonical_claim  number category_id FK  varchar status  varchar claim_origin }
    CLAIM_VARIANTS { number variant_id PK  number claim_id FK  number source_id FK  number parent_variant_id FK  varchar variant_text  varchar actor  varchar action  varchar target_object  varchar location_name  varchar event_name  varchar claimed_date  varchar quantity_value  varchar certainty  varchar attribution  number match_score  varchar match_method }
    CLAIM_MUTATIONS { number mutation_id PK  number claim_id FK  number parent_variant_id FK  number child_variant_id FK  varchar changed_component  varchar old_value  varchar new_value  char is_escalation }
    FINGERPRINTS { number fingerprint_id PK  number claim_id FK  varchar core_assertion  varchar sentiment  varchar emotional_hook  varchar manipulation_marker  varchar source_pattern }
    ENTITIES { number entity_id PK  varchar entity_name  varchar entity_type }
    ENTITY_ALIASES { number alias_id PK  number entity_id FK  varchar alias_text UK }
    ENTITY_CANDIDATES { number candidate_id PK  varchar candidate_text UK  number occurrence_count  number first_seen_source_id FK }
    CLAIM_ENTITIES { number claim_id PK  number entity_id PK }
    KEYWORDS { number keyword_id PK  varchar keyword_text UK }
    CLAIM_KEYWORDS { number claim_id PK  number keyword_id PK  number weight }
    WEB_SEARCH_RUNS { number search_run_id PK  varchar query_text  timestamp started_at  timestamp completed_at  number results_received  number pages_fetched  number pages_failed  number sources_inserted  number duplicates_skipped  number claims_matched  number claims_created  varchar status  varchar error_message }
    SEARCH_RESULT_LINKS { number search_run_id PK  number source_id PK  number search_rank  varchar search_provider  varchar result_snippet  timestamp retrieved_at }
    SOURCE_REFERENCES { number reference_id PK  number from_source_id FK  number to_source_id FK  varchar reference_type  timestamp detected_at  varchar confidence_basis }
    AUDIT_LOG { number audit_id PK  varchar table_name  varchar operation  number record_id  timestamp changed_at }
```

Relationship types shown:

- **One-to-many:** PLATFORMS → SOURCES, CLAIMS → CLAIM_VARIANTS, ENTITIES → ENTITY_ALIASES …
- **One-to-one:** CLAIMS → FINGERPRINTS (enforced by `UQ_FINGERPRINTS_CLAIM`)
- **Many-to-many:** CLAIMS ↔ ENTITIES (CLAIM_ENTITIES), CLAIMS ↔ KEYWORDS (CLAIM_KEYWORDS), WEB_SEARCH_RUNS ↔ SOURCES (SEARCH_RESULT_LINKS), SOURCES ↔ SOURCES (SOURCE_REFERENCES)
- **Self-referencing:** SOURCES.derived_from_source_id (source lineage), CLAIM_VARIANTS.parent_variant_id (claim lineage)
