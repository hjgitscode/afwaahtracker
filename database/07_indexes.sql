--------------------------------------------------------------------------------
-- AfwaahTracker :: 07_indexes.sql
-- B-tree indexes on foreign keys and frequent filters, plus function-based
-- indexes that support case-insensitive search. (UNIQUE constraints in
-- 02_constraints.sql already create unique indexes, e.g. on SOURCES.source_url,
-- which makes duplicate detection during ingestion an index lookup.)
--------------------------------------------------------------------------------
PROMPT Creating indexes ...

-- Function-based UNIQUE index: an external id (e.g. a Hacker News story id)
-- may appear only once per platform. Rows without an external id are not indexed.
CREATE UNIQUE INDEX ux_sources_external ON sources (
    CASE WHEN external_source_id IS NOT NULL THEN platform_id END,
    external_source_id);

-- Foreign-key indexes (speed up joins and avoid table locks on parent DML)
CREATE INDEX ix_sources_platform        ON sources (platform_id);
CREATE INDEX ix_sources_derived_from    ON sources (derived_from_source_id);
CREATE INDEX ix_sources_ingestion       ON sources (ingestion_source_id);
CREATE INDEX ix_variants_claim          ON claim_variants (claim_id);
CREATE INDEX ix_variants_source         ON claim_variants (source_id);
CREATE INDEX ix_variants_parent         ON claim_variants (parent_variant_id);
CREATE INDEX ix_claims_category         ON claims (category_id);
CREATE INDEX ix_claim_entities_entity   ON claim_entities (entity_id);
CREATE INDEX ix_claim_keywords_keyword  ON claim_keywords (keyword_id);
CREATE INDEX ix_aliases_entity          ON entity_aliases (entity_id);
CREATE INDEX ix_mutations_claim         ON claim_mutations (claim_id);
CREATE INDEX ix_mutations_child         ON claim_mutations (child_variant_id);
CREATE INDEX ix_ingestion_log_source    ON ingestion_log (ingestion_source_id, started_at);

-- Frequent filters / sort keys
CREATE INDEX ix_sources_published       ON sources (published_at);
CREATE INDEX ix_sources_origin_fetched  ON sources (origin_type, fetched_at);
CREATE INDEX ix_claims_status           ON claims (status);
CREATE INDEX ix_audit_changed_at        ON audit_log (changed_at);

-- Function-based indexes for case-insensitive search
CREATE INDEX ix_claims_lower_text       ON claims (LOWER(canonical_claim));
CREATE INDEX ix_sources_lower_publisher ON sources (LOWER(publisher));
CREATE INDEX ix_entities_lower_name     ON entities (LOWER(entity_name));
CREATE INDEX ix_aliases_lower_text      ON entity_aliases (LOWER(alias_text));

PROMPT Indexes created.
