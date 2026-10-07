--------------------------------------------------------------------------------
-- AfwaahTracker :: 02_constraints.sql
-- Referential integrity (FOREIGN KEY), uniqueness (UNIQUE) and domain
-- integrity (CHECK) constraints, added with ALTER TABLE.
--------------------------------------------------------------------------------
SET DEFINE OFF
PROMPT Adding constraints ...

-- ---------- PLATFORMS ----------
ALTER TABLE platforms ADD CONSTRAINT uq_platforms_name UNIQUE (platform_name);
ALTER TABLE platforms ADD CONSTRAINT ck_platforms_type
    CHECK (platform_type IN ('NEWS','FORUM','SOCIAL','BLOG','MESSAGING','VIDEO','OFFICIAL','AGGREGATOR'));

-- ---------- CATEGORIES ----------
ALTER TABLE categories ADD CONSTRAINT uq_categories_name UNIQUE (category_name);

-- ---------- INGESTION_SOURCES ----------
ALTER TABLE ingestion_sources ADD CONSTRAINT uq_ingestion_sources_name UNIQUE (source_name);
ALTER TABLE ingestion_sources ADD CONSTRAINT fk_ingestion_sources_platform
    FOREIGN KEY (platform_id) REFERENCES platforms (platform_id);
ALTER TABLE ingestion_sources ADD CONSTRAINT fk_ingestion_sources_category
    FOREIGN KEY (default_category_id) REFERENCES categories (category_id);
ALTER TABLE ingestion_sources ADD CONSTRAINT ck_ingestion_sources_type
    CHECK (source_type IN ('GDELT','HACKER_NEWS','RSS'));
ALTER TABLE ingestion_sources ADD CONSTRAINT ck_ingestion_sources_enabled
    CHECK (enabled IN ('Y','N'));
ALTER TABLE ingestion_sources ADD CONSTRAINT ck_ingestion_sources_interval
    CHECK (fetch_interval_minutes BETWEEN 5 AND 10080);
ALTER TABLE ingestion_sources ADD CONSTRAINT ck_ingestion_sources_max
    CHECK (max_items BETWEEN 1 AND 250);

-- ---------- INGESTION_LOG ----------
ALTER TABLE ingestion_log ADD CONSTRAINT fk_ingestion_log_source
    FOREIGN KEY (ingestion_source_id) REFERENCES ingestion_sources (ingestion_source_id)
    ON DELETE CASCADE;
ALTER TABLE ingestion_log ADD CONSTRAINT ck_ingestion_log_status
    CHECK (status IN ('RUNNING','SUCCESS','PARTIAL','FAILED'));
ALTER TABLE ingestion_log ADD CONSTRAINT ck_ingestion_log_counts
    CHECK (records_fetched >= 0 AND records_inserted >= 0 AND records_skipped >= 0 AND records_matched >= 0);
ALTER TABLE ingestion_log ADD CONSTRAINT ck_ingestion_log_dates
    CHECK (completed_at IS NULL OR completed_at >= started_at);

-- ---------- SOURCES ----------
ALTER TABLE sources ADD CONSTRAINT uq_sources_url UNIQUE (source_url);
-- (platform_id, external_source_id) uniqueness is enforced by the function-based
-- unique index UX_SOURCES_EXTERNAL in 07_indexes.sql, because a composite UNIQUE
-- constraint would treat rows with a NULL external id as duplicates.
ALTER TABLE sources ADD CONSTRAINT fk_sources_platform
    FOREIGN KEY (platform_id) REFERENCES platforms (platform_id);
ALTER TABLE sources ADD CONSTRAINT fk_sources_ingestion
    FOREIGN KEY (ingestion_source_id) REFERENCES ingestion_sources (ingestion_source_id)
    ON DELETE SET NULL;
-- Self-referencing relationship: source provenance
ALTER TABLE sources ADD CONSTRAINT fk_sources_derived_from
    FOREIGN KEY (derived_from_source_id) REFERENCES sources (source_id)
    ON DELETE SET NULL;
ALTER TABLE sources ADD CONSTRAINT ck_sources_not_self_derived
    CHECK (derived_from_source_id IS NULL OR derived_from_source_id <> source_id);
ALTER TABLE sources ADD CONSTRAINT ck_sources_status
    CHECK (source_status IN ('ACTIVE','UNAVAILABLE','REMOVED','ARCHIVED'));
ALTER TABLE sources ADD CONSTRAINT ck_sources_origin
    CHECK (origin_type IN ('DEMO','AUTOMATED','MANUAL'));
ALTER TABLE sources ADD CONSTRAINT ck_sources_engagement
    CHECK (engagement_count >= 0);
ALTER TABLE sources ADD CONSTRAINT ck_sources_url_format
    CHECK (REGEXP_LIKE(source_url, '^https?://'));

-- ---------- CLAIMS ----------
ALTER TABLE claims ADD CONSTRAINT fk_claims_category
    FOREIGN KEY (category_id) REFERENCES categories (category_id);
ALTER TABLE claims ADD CONSTRAINT ck_claims_status
    CHECK (status IN ('UNVERIFIED','DEVELOPING','CORROBORATED','DISPUTED','DEBUNKED','CANDIDATE'));
ALTER TABLE claims ADD CONSTRAINT ck_claims_origin
    CHECK (claim_origin IN ('DEMO','AUTOMATED','MANUAL'));

-- ---------- CLAIM_VARIANTS ----------
ALTER TABLE claim_variants ADD CONSTRAINT fk_variants_claim
    FOREIGN KEY (claim_id) REFERENCES claims (claim_id) ON DELETE CASCADE;
ALTER TABLE claim_variants ADD CONSTRAINT fk_variants_source
    FOREIGN KEY (source_id) REFERENCES sources (source_id) ON DELETE CASCADE;
-- Self-referencing relationship: claim (wording) lineage
ALTER TABLE claim_variants ADD CONSTRAINT fk_variants_parent
    FOREIGN KEY (parent_variant_id) REFERENCES claim_variants (variant_id) ON DELETE SET NULL;
ALTER TABLE claim_variants ADD CONSTRAINT uq_variants_claim_source UNIQUE (claim_id, source_id);
ALTER TABLE claim_variants ADD CONSTRAINT ck_variants_not_self_parent
    CHECK (parent_variant_id IS NULL OR parent_variant_id <> variant_id);
ALTER TABLE claim_variants ADD CONSTRAINT ck_variants_certainty
    CHECK (certainty IN ('UNSTATED','QUESTIONED','POSSIBLE','EXPECTED','CONFIRMED','DENIED'));
ALTER TABLE claim_variants ADD CONSTRAINT ck_variants_score
    CHECK (match_score BETWEEN 0 AND 100);
ALTER TABLE claim_variants ADD CONSTRAINT ck_variants_method
    CHECK (match_method IN ('CURATED','RULE_STRONG','RULE_CANDIDATE','NEW_CLAIM','MANUAL'));
ALTER TABLE claim_variants ADD CONSTRAINT ck_variants_lineage_basis
    CHECK (lineage_basis IN ('CURATED','AUTO_ROOT','NONE','MANUAL'));

-- ---------- ENTITIES ----------
ALTER TABLE entities ADD CONSTRAINT uq_entities_name_type UNIQUE (entity_name, entity_type);
ALTER TABLE entities ADD CONSTRAINT ck_entities_type
    CHECK (entity_type IN ('PERSON','ORGANISATION','LOCATION','EVENT','TOPIC'));

ALTER TABLE entity_aliases ADD CONSTRAINT fk_aliases_entity
    FOREIGN KEY (entity_id) REFERENCES entities (entity_id) ON DELETE CASCADE;
ALTER TABLE entity_aliases ADD CONSTRAINT uq_aliases_text UNIQUE (alias_text);

ALTER TABLE claim_entities ADD CONSTRAINT fk_claim_entities_claim
    FOREIGN KEY (claim_id) REFERENCES claims (claim_id) ON DELETE CASCADE;
ALTER TABLE claim_entities ADD CONSTRAINT fk_claim_entities_entity
    FOREIGN KEY (entity_id) REFERENCES entities (entity_id) ON DELETE CASCADE;
ALTER TABLE claim_entities ADD CONSTRAINT ck_claim_entities_detected
    CHECK (detected_by IN ('CURATED','DICTIONARY','MANUAL'));

ALTER TABLE entity_candidates ADD CONSTRAINT uq_entity_candidates_text UNIQUE (candidate_text);
ALTER TABLE entity_candidates ADD CONSTRAINT fk_entity_candidates_source
    FOREIGN KEY (first_seen_source_id) REFERENCES sources (source_id) ON DELETE SET NULL;
ALTER TABLE entity_candidates ADD CONSTRAINT ck_entity_candidates_status
    CHECK (status IN ('PENDING','PROMOTED','IGNORED'));

-- ---------- KEYWORDS ----------
ALTER TABLE keywords ADD CONSTRAINT uq_keywords_text UNIQUE (keyword_text);
ALTER TABLE keywords ADD CONSTRAINT ck_keywords_origin
    CHECK (keyword_origin IN ('CURATED','AUTO'));
ALTER TABLE keywords ADD CONSTRAINT ck_keywords_lower
    CHECK (keyword_text = LOWER(keyword_text));

ALTER TABLE claim_keywords ADD CONSTRAINT fk_claim_keywords_claim
    FOREIGN KEY (claim_id) REFERENCES claims (claim_id) ON DELETE CASCADE;
ALTER TABLE claim_keywords ADD CONSTRAINT fk_claim_keywords_keyword
    FOREIGN KEY (keyword_id) REFERENCES keywords (keyword_id) ON DELETE CASCADE;
ALTER TABLE claim_keywords ADD CONSTRAINT ck_claim_keywords_weight
    CHECK (weight BETWEEN 1 AND 10);

-- ---------- FINGERPRINTS ----------
ALTER TABLE fingerprints ADD CONSTRAINT uq_fingerprints_claim UNIQUE (claim_id);
ALTER TABLE fingerprints ADD CONSTRAINT fk_fingerprints_claim
    FOREIGN KEY (claim_id) REFERENCES claims (claim_id) ON DELETE CASCADE;
ALTER TABLE fingerprints ADD CONSTRAINT ck_fingerprints_sentiment
    CHECK (sentiment IS NULL OR sentiment IN ('POSITIVE','NEGATIVE','NEUTRAL','MIXED'));
ALTER TABLE fingerprints ADD CONSTRAINT ck_fingerprints_curated
    CHECK (is_curated IN ('Y','N'));

-- ---------- CLAIM_MUTATIONS ----------
ALTER TABLE claim_mutations ADD CONSTRAINT fk_mutations_claim
    FOREIGN KEY (claim_id) REFERENCES claims (claim_id) ON DELETE CASCADE;
ALTER TABLE claim_mutations ADD CONSTRAINT fk_mutations_parent
    FOREIGN KEY (parent_variant_id) REFERENCES claim_variants (variant_id) ON DELETE CASCADE;
ALTER TABLE claim_mutations ADD CONSTRAINT fk_mutations_child
    FOREIGN KEY (child_variant_id) REFERENCES claim_variants (variant_id) ON DELETE CASCADE;
ALTER TABLE claim_mutations ADD CONSTRAINT uq_mutations_pair_component
    UNIQUE (parent_variant_id, child_variant_id, changed_component);
ALTER TABLE claim_mutations ADD CONSTRAINT ck_mutations_component
    CHECK (changed_component IN ('ACTOR','ACTION','TARGET','LOCATION','EVENT','DATE','QUANTITY','CERTAINTY','ATTRIBUTION'));
ALTER TABLE claim_mutations ADD CONSTRAINT ck_mutations_escalation
    CHECK (is_escalation IN ('Y','N'));
ALTER TABLE claim_mutations ADD CONSTRAINT ck_mutations_distinct_pair
    CHECK (parent_variant_id <> child_variant_id);

-- ---------- AUDIT_LOG ----------
ALTER TABLE audit_log ADD CONSTRAINT ck_audit_operation
    CHECK (operation IN ('INSERT','UPDATE','DELETE'));

PROMPT Constraints added.
