--------------------------------------------------------------------------------
-- AfwaahTracker :: 15_self_repetition.sql
-- Self-repetition: the same publisher (site or social account) posting the
-- same claim more than once. Shown NEXT TO the Known Echo Ratio; the Known
-- Echo Ratio itself, lineage and the Mutation Ledger are not changed.
-- Safe to run again (CREATE OR REPLACE only; no table or data changes).
--
--   PUBLISHER_IDENTITY   who published a source, deterministically:
--                        ordinary site  -> its host (www./m./amp. removed;
--                                          an IP address / localhost -> stated publisher)
--                        social post    -> the account in the URL
--                                          (instagram.com/<account>, x.com/<user>,
--                                          youtube.com/@channel, facebook.com/<page>,
--                                          tiktok.com/@user, t.me/<channel>,
--                                          reddit.com/user/<name>, linkedin ...)
--                                          or a handle given as the publisher
--                                          ("@account", "r/sub", "u/name")
--                        unknown account -> unique to that source: never
--                                          grouped with anything by guesswork
--   VW_CLAIM_REPETITION  per claim: sources, distinct publishers,
--                        repeated sources and
--                        Self-Repetition = (sources - publishers) / sources x 100
--------------------------------------------------------------------------------
SET DEFINE OFF
SET SQLBLANKLINES ON

CREATE OR REPLACE FUNCTION publisher_identity (
    p_source_id IN NUMBER,
    p_url       IN VARCHAR2,
    p_publisher IN VARCHAR2
) RETURN VARCHAR2 DETERMINISTIC
IS
    v_host    VARCHAR2(300) := LOWER(REGEXP_SUBSTR(p_url, '^https?://([^/:?#]+)', 1, 1, 'i', 1));
    v_path    VARCHAR2(1000) := REGEXP_SUBSTR(p_url, '^https?://[^/]+(/[^?#]*)', 1, 1, 'i', 1);
    v_account VARCHAR2(200);
    v_pub     VARCHAR2(200) := TRIM(p_publisher);
BEGIN
    v_host := REGEXP_REPLACE(v_host, '^(www|m|mobile|amp)\.', '');
    IF v_host = 'twitter.com' THEN
        v_host := 'x.com';   -- the same account on either address
    END IF;
    -- An IP address or localhost names a machine, not a publisher: use the
    -- publisher the page states, if any
    IF REGEXP_LIKE(v_host, '^([0-9]{1,3}\.){3}[0-9]{1,3}$') OR v_host = 'localhost' THEN
        -- ... unless that is only a platform name or an address ("YouTube", "127.0.0.1")
        RETURN CASE WHEN name_key(v_pub) IS NOT NULL
                     AND NOT REGEXP_LIKE(LOWER(v_pub), '^(youtube|instagram|x|twitter|facebook|reddit|tiktok|telegram|whatsapp|threads|linkedin|web page|[0-9.:]+)$')
                    THEN 'PUBLISHER:' || name_key(v_pub)
                    ELSE 'SOURCE#' || p_source_id END;
    END IF;
    IF v_host IS NULL THEN
        RETURN 'SOURCE#' || p_source_id;
    END IF;

    -- Platforms where many unrelated people publish: the account decides
    IF REGEXP_LIKE(v_host, '(^|\.)(instagram|twitter|x|youtube|youtu|facebook|fb|tiktok|reddit|t|telegram|whatsapp|whatsapp-forward|threads|linkedin|ycombinator|pinterest|snapchat)\.[a-z.]+$') THEN
        -- A handle given as the publisher ("@vitfestupdates", "r/VITians", "u/name")
        IF REGEXP_LIKE(v_pub, '^(@|r/|u/)[A-Za-z0-9._-]+') THEN
            RETURN v_host || '/' || LOWER(REGEXP_SUBSTR(v_pub, '^(@|r/|u/)[A-Za-z0-9._-]+'));
        END IF;
        v_account := COALESCE(
            REGEXP_SUBSTR(v_path, '^/@([A-Za-z0-9._-]+)', 1, 1, 'i', 1),                                   -- youtube/tiktok/threads @handle
            REGEXP_SUBSTR(v_path, '^/(channel|c|user|in|company)/([A-Za-z0-9._-]+)', 1, 1, 'i', 2),      -- youtube channel, linkedin
            REGEXP_SUBSTR(v_path, '^/(user|u)/([A-Za-z0-9._-]+)', 1, 1, 'i', 2),                          -- reddit user
            REGEXP_SUBSTR(v_path, '^/([A-Za-z0-9_]+)/status/', 1, 1, 'i', 1),                               -- x / twitter
            REGEXP_SUBSTR(v_path, '^/([A-Za-z0-9._-]+)/(posts|videos|photos|reels)/', 1, 1, 'i', 1),      -- facebook page
            REGEXP_SUBSTR(v_path, '^/([A-Za-z0-9_]{4,})/[0-9]+', 1, 1, 'i', 1),                             -- t.me/<channel>/<id>
            CASE WHEN REGEXP_LIKE(v_host, '(^|\.)instagram\.')
                  AND NOT REGEXP_LIKE(v_path, '^/(p|reel|reels|tv|stories|explore|accounts)(/|$)', 'i')
                 THEN REGEXP_SUBSTR(v_path, '^/([A-Za-z0-9._]+)/?', 1, 1, 'i', 1) END);              -- instagram.com/<account>
        IF v_account IS NOT NULL THEN
            RETURN v_host || '/' || LOWER(v_account);
        END IF;
        RETURN 'SOURCE#' || p_source_id;   -- account unknown: never grouped
    END IF;

    RETURN v_host;
END publisher_identity;
/

CREATE OR REPLACE VIEW vw_claim_repetition AS
WITH x AS (
    SELECT v.claim_id, s.source_id, s.publisher,
           publisher_identity(s.source_id, s.source_url, s.publisher) AS publisher_id
      FROM claim_variants v
      JOIN sources s ON s.source_id = v.source_id
), g AS (
    SELECT claim_id, publisher_id, MIN(publisher) AS publisher_label, COUNT(DISTINCT source_id) AS posts
      FROM x
     GROUP BY claim_id, publisher_id
)
SELECT claim_id,
       SUM(posts)                                              AS source_count,
       COUNT(*)                                                AS publisher_count,
       SUM(posts) - COUNT(*)                                   AS repeated_sources,
       CASE WHEN SUM(posts) = 0 THEN 0
            ELSE ROUND((SUM(posts) - COUNT(*)) / SUM(posts) * 100, 1) END AS self_repetition_ratio,
       LISTAGG(CASE WHEN posts > 1 THEN publisher_label || ' x' || posts END, ', ')
         WITHIN GROUP (ORDER BY posts DESC, publisher_label)   AS repeated_publishers
  FROM g
 GROUP BY claim_id;
