--------------------------------------------------------------------------------
-- AfwaahTracker :: 09_ingestion_support.sql
-- Database side of the automated ingestion pipeline:
--   * INGEST_SOURCE            function: deduplicated insert of one fetched item
--   * START_INGESTION_RUN      function: opens an INGESTION_LOG row
--   * FINISH_INGESTION_RUN     procedure: closes an INGESTION_LOG row
--   * LINK_CLAIM_ENTITY        procedure: MERGE into CLAIM_ENTITIES
--   * LINK_CLAIM_KEYWORD       procedure: MERGE into KEYWORDS + CLAIM_KEYWORDS
--   * RECORD_ENTITY_CANDIDATE  procedure: MERGE into ENTITY_CANDIDATES
--   * default INGESTION_SOURCES registry (GDELT, Hacker News, RSS/Atom)
--   * extra dictionary entities that help recognise live news
--------------------------------------------------------------------------------
SET DEFINE OFF
PROMPT Creating ingestion support ...

--------------------------------------------------------------------------------
-- Deduplicated insert. Returns the new SOURCE_ID, or 0 when the item is
-- already stored (same normalised URL, or same platform + external id).
-- Duplicate detection is an index lookup on UQ_SOURCES_URL /
-- UQ_SOURCES_EXTERNAL, and DUP_VAL_ON_INDEX covers concurrent inserts.
--
-- Source dependence is only recorded when it is deterministic: if the item
-- links to a URL that is already stored (e.g. a Hacker News discussion whose
-- submitted link is a stored article), the item is marked as derived from it.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ingest_source (
    p_platform_id         IN NUMBER,
    p_ingestion_source_id IN NUMBER,
    p_publisher           IN VARCHAR2,
    p_author              IN VARCHAR2,
    p_title               IN VARCHAR2,
    p_url                 IN VARCHAR2,
    p_linked_url          IN VARCHAR2,
    p_external_id         IN VARCHAR2,
    p_published_at        IN TIMESTAMP,
    p_snippet             IN VARCHAR2,
    p_engagement          IN NUMBER
) RETURN NUMBER
IS
    v_exists      NUMBER;
    v_parent_id   NUMBER;
    v_new_id      NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists
      FROM sources
     WHERE source_url = p_url
        OR (p_external_id IS NOT NULL
            AND platform_id = p_platform_id
            AND external_source_id = p_external_id);

    IF v_exists > 0 THEN
        RETURN 0;
    END IF;

    IF p_linked_url IS NOT NULL AND p_linked_url <> p_url THEN
        BEGIN
            SELECT source_id INTO v_parent_id
              FROM sources
             WHERE source_url = p_linked_url;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN v_parent_id := NULL;
        END;
    END IF;

    INSERT INTO sources
        (platform_id, ingestion_source_id, publisher, author, source_title,
         source_url, linked_url, external_source_id, published_at, snippet,
         engagement_count, source_status, origin_type,
         derived_from_source_id, provenance_note)
    VALUES
        (p_platform_id, p_ingestion_source_id, SUBSTR(p_publisher, 1, 200),
         SUBSTR(p_author, 1, 200), SUBSTR(p_title, 1, 1000), p_url,
         p_linked_url, p_external_id, NVL(p_published_at, SYSTIMESTAMP),
         SUBSTR(p_snippet, 1, 4000), GREATEST(NVL(p_engagement, 0), 0),
         'ACTIVE', 'AUTOMATED', v_parent_id,
         CASE WHEN v_parent_id IS NOT NULL
              THEN 'Submitted link points to stored source #' || v_parent_id
                   || ' (deterministic URL match).'
              ELSE 'Automatically ingested. No deterministic upstream source known.'
         END)
    RETURNING source_id INTO v_new_id;

    RETURN v_new_id;
EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        RETURN 0;
END ingest_source;
/

CREATE OR REPLACE FUNCTION start_ingestion_run (p_ingestion_source_id IN NUMBER)
RETURN NUMBER
IS
    v_log_id NUMBER;
BEGIN
    INSERT INTO ingestion_log (ingestion_source_id, status)
    VALUES (p_ingestion_source_id, 'RUNNING')
    RETURNING log_id INTO v_log_id;
    RETURN v_log_id;
END start_ingestion_run;
/

CREATE OR REPLACE PROCEDURE finish_ingestion_run (
    p_log_id    IN NUMBER,
    p_fetched   IN NUMBER,
    p_inserted  IN NUMBER,
    p_skipped   IN NUMBER,
    p_matched   IN NUMBER,
    p_status    IN VARCHAR2,
    p_error     IN VARCHAR2 DEFAULT NULL
)
IS
BEGIN
    UPDATE ingestion_log
       SET completed_at     = SYSTIMESTAMP,
           records_fetched  = NVL(p_fetched, 0),
           records_inserted = NVL(p_inserted, 0),
           records_skipped  = NVL(p_skipped, 0),
           records_matched  = NVL(p_matched, 0),
           status           = p_status,
           error_message    = SUBSTR(p_error, 1, 1000)
     WHERE log_id = p_log_id;

    IF SQL%ROWCOUNT = 0 THEN
        RAISE_APPLICATION_ERROR(-20030, 'Ingestion log ' || p_log_id || ' not found.');
    END IF;
END finish_ingestion_run;
/

CREATE OR REPLACE PROCEDURE link_claim_entity (
    p_claim_id   IN NUMBER,
    p_entity_id  IN NUMBER,
    p_detected_by IN VARCHAR2 DEFAULT 'DICTIONARY'
)
IS
BEGIN
    MERGE INTO claim_entities ce
    USING (SELECT p_claim_id AS claim_id, p_entity_id AS entity_id FROM dual) src
       ON (ce.claim_id = src.claim_id AND ce.entity_id = src.entity_id)
     WHEN NOT MATCHED THEN
          INSERT (claim_id, entity_id, detected_by)
          VALUES (src.claim_id, src.entity_id, p_detected_by);
END link_claim_entity;
/

CREATE OR REPLACE PROCEDURE link_claim_keyword (
    p_claim_id     IN NUMBER,
    p_keyword_text IN VARCHAR2,
    p_origin       IN VARCHAR2 DEFAULT 'AUTO'
)
IS
    v_text       keywords.keyword_text%TYPE := LOWER(TRIM(SUBSTR(p_keyword_text, 1, 80)));
    v_keyword_id NUMBER;
BEGIN
    IF v_text IS NULL THEN
        RETURN;
    END IF;

    MERGE INTO keywords k
    USING (SELECT v_text AS keyword_text FROM dual) src
       ON (k.keyword_text = src.keyword_text)
     WHEN NOT MATCHED THEN
          INSERT (keyword_text, keyword_origin) VALUES (src.keyword_text, p_origin);

    SELECT keyword_id INTO v_keyword_id FROM keywords WHERE keyword_text = v_text;

    MERGE INTO claim_keywords ck
    USING (SELECT p_claim_id AS claim_id, v_keyword_id AS keyword_id FROM dual) src
       ON (ck.claim_id = src.claim_id AND ck.keyword_id = src.keyword_id)
     WHEN MATCHED THEN
          UPDATE SET ck.weight = LEAST(ck.weight + 1, 10)
     WHEN NOT MATCHED THEN
          INSERT (claim_id, keyword_id, weight) VALUES (src.claim_id, src.keyword_id, 1);
END link_claim_keyword;
/

CREATE OR REPLACE PROCEDURE record_entity_candidate (
    p_text      IN VARCHAR2,
    p_source_id IN NUMBER
)
IS
    v_text entity_candidates.candidate_text%TYPE := TRIM(SUBSTR(p_text, 1, 200));
BEGIN
    IF v_text IS NULL THEN
        RETURN;
    END IF;

    MERGE INTO entity_candidates ec
    USING (SELECT v_text AS candidate_text FROM dual) src
       ON (ec.candidate_text = src.candidate_text)
     WHEN MATCHED THEN
          UPDATE SET ec.occurrence_count = ec.occurrence_count + 1,
                     ec.last_seen_at     = SYSTIMESTAMP
     WHEN NOT MATCHED THEN
          INSERT (candidate_text, first_seen_source_id)
          VALUES (src.candidate_text, p_source_id);
END record_entity_candidate;
/

SHOW ERRORS

PROMPT Seeding ingestion source registry ...
SET FEEDBACK OFF

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('GDELT - India technology and education', 'GDELT',
        'https://api.gdeltproject.org/api/v2/doc/doc?query=(technology%20OR%20education%20OR%20university)%20sourcecountry:india%20sourcelang:english&mode=artlist&format=json&maxrecords=25&sort=datedesc',
        (SELECT platform_id FROM platforms WHERE platform_name = 'News Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Technology'), 'Y', 60, 25);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('GDELT - Science, space and health', 'GDELT',
        'https://api.gdeltproject.org/api/v2/doc/doc?query=(science%20OR%20space%20OR%20health)%20sourcelang:english&mode=artlist&format=json&maxrecords=25&sort=datedesc',
        (SELECT platform_id FROM platforms WHERE platform_name = 'News Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Science'), 'Y', 120, 25);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('Hacker News - Top stories', 'HACKER_NEWS',
        'https://hacker-news.firebaseio.com/v0/topstories.json',
        (SELECT platform_id FROM platforms WHERE platform_name = 'Hacker News'),
        (SELECT category_id FROM categories WHERE category_name = 'Technology'), 'Y', 60, 30);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('BBC News - Technology', 'RSS',
        'https://feeds.bbci.co.uk/news/technology/rss.xml',
        (SELECT platform_id FROM platforms WHERE platform_name = 'News Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Technology'), 'Y', 60, 20);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('BBC News - Science and environment', 'RSS',
        'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
        (SELECT platform_id FROM platforms WHERE platform_name = 'News Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Science'), 'Y', 60, 20);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('The Hindu - Education', 'RSS',
        'https://www.thehindu.com/education/feeder/default.rss',
        (SELECT platform_id FROM platforms WHERE platform_name = 'News Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Education'), 'Y', 120, 20);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('NASA - News releases', 'RSS',
        'https://www.nasa.gov/news-release/feed/',
        (SELECT platform_id FROM platforms WHERE platform_name = 'Official Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Science'), 'Y', 180, 15);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('WHO - News', 'RSS',
        'https://www.who.int/rss-feeds/news-english.xml',
        (SELECT platform_id FROM platforms WHERE platform_name = 'Official Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Health'), 'Y', 180, 15);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('ScienceDaily - Top science', 'RSS',
        'https://www.sciencedaily.com/rss/top/science.xml',
        (SELECT platform_id FROM platforms WHERE platform_name = 'News Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Science'), 'Y', 180, 15);

INSERT INTO ingestion_sources (source_name, source_type, endpoint_url, platform_id, default_category_id, enabled, fetch_interval_minutes, max_items)
VALUES ('Ars Technica - All stories', 'RSS',
        'https://feeds.arstechnica.com/arstechnica/index',
        (SELECT platform_id FROM platforms WHERE platform_name = 'News Website'),
        (SELECT category_id FROM categories WHERE category_name = 'Technology'), 'N', 120, 20);

PROMPT Adding ingestion dictionary entities ...

-- Additional dictionary entries that commonly appear in live news.
-- Short all-capital aliases (e.g. WHO, AI, EU) are matched case-sensitively
-- by the ingestion matcher so that ordinary words are not mistaken for them.
DECLARE
    TYPE t_entity IS RECORD (name VARCHAR2(200), etype VARCHAR2(20), aliases VARCHAR2(400));
    TYPE t_entities IS TABLE OF t_entity;
    v_list t_entities := t_entities(
        t_entity('Google',                         'ORGANISATION', 'Alphabet'),
        t_entity('Apple',                          'ORGANISATION', 'iPhone'),
        t_entity('Microsoft',                      'ORGANISATION', 'Windows'),
        t_entity('OpenAI',                         'ORGANISATION', 'ChatGPT'),
        t_entity('Meta',                           'ORGANISATION', 'Facebook|Instagram'),
        t_entity('Amazon',                         'ORGANISATION', 'AWS'),
        t_entity('Nvidia',                         'ORGANISATION', NULL),
        t_entity('SpaceX',                         'ORGANISATION', 'Starship'),
        t_entity('ISRO',                           'ORGANISATION', 'Indian Space Research Organisation'),
        t_entity('World Health Organization',      'ORGANISATION', 'WHO'),
        t_entity('European Union',                 'ORGANISATION', 'EU'),
        t_entity('United States',                  'LOCATION',     'USA|US|America'),
        t_entity('United Kingdom',                 'LOCATION',     'UK|Britain'),
        t_entity('China',                          'LOCATION',     'Chinese'),
        t_entity('Mumbai',                         'LOCATION',     'Bombay'),
        t_entity('Artificial Intelligence',        'TOPIC',        'AI'),
        t_entity('Climate Change',                 'TOPIC',        'global warming'),
        t_entity('Cybersecurity',                  'TOPIC',        'data breach|ransomware'),
        t_entity('Vaccine',                        'TOPIC',        'vaccines|vaccination')
    );
    v_entity_id NUMBER;
    v_alias     VARCHAR2(200);
    v_pos       PLS_INTEGER;
    v_rest      VARCHAR2(400);
BEGIN
    FOR i IN 1 .. v_list.COUNT LOOP
        BEGIN
            INSERT INTO entities (entity_name, entity_type, description)
            VALUES (v_list(i).name, v_list(i).etype, 'Ingestion dictionary entry')
            RETURNING entity_id INTO v_entity_id;
        EXCEPTION
            WHEN DUP_VAL_ON_INDEX THEN
                SELECT entity_id INTO v_entity_id FROM entities
                 WHERE entity_name = v_list(i).name AND entity_type = v_list(i).etype;
        END;

        v_rest := v_list(i).name || CASE WHEN v_list(i).aliases IS NOT NULL
                                         THEN '|' || v_list(i).aliases END;
        WHILE v_rest IS NOT NULL LOOP
            v_pos := INSTR(v_rest, '|');
            IF v_pos = 0 THEN
                v_alias := v_rest;
                v_rest  := NULL;
            ELSE
                v_alias := SUBSTR(v_rest, 1, v_pos - 1);
                v_rest  := SUBSTR(v_rest, v_pos + 1);
            END IF;
            BEGIN
                INSERT INTO entity_aliases (entity_id, alias_text) VALUES (v_entity_id, v_alias);
            EXCEPTION
                WHEN DUP_VAL_ON_INDEX THEN NULL;
            END;
        END LOOP;
    END LOOP;
END;
/

COMMIT;
SET FEEDBACK ON
PROMPT Ingestion support created.
