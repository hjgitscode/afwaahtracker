import { query } from '../db/pool.js';

export function listPlatforms() {
  return query(
    `SELECT platform_id, platform_name, platform_type, source_count, claim_count,
            independent_count, derived_count, avg_engagement, first_published, last_published
       FROM vw_platform_statistics
      ORDER BY source_count DESC, platform_name`
  );
}

export function listCategories() {
  return query(
    `SELECT c.category_id, c.category_name, c.description, COUNT(cl.claim_id) AS claim_count
       FROM categories c
       LEFT JOIN claims cl ON cl.category_id = c.category_id
      GROUP BY c.category_id, c.category_name, c.description
      ORDER BY c.category_id`
  );
}

export function listEntities({ type, q } = {}) {
  const binds = {};
  const where = [];
  if (['PERSON', 'ORGANISATION', 'LOCATION', 'EVENT', 'TOPIC'].includes(type)) {
    binds.type = type;
    where.push('e.entity_type = :type');
  }
  if (q && String(q).trim()) {
    binds.q = `%${String(q).trim().toLowerCase().slice(0, 80)}%`;
    where.push(`(LOWER(e.entity_name) LIKE :q OR EXISTS (SELECT 1 FROM entity_aliases a
                 WHERE a.entity_id = e.entity_id AND LOWER(a.alias_text) LIKE :q))`);
  }
  return query(
    `SELECT e.entity_id, e.entity_name, e.entity_type, e.description,
            COUNT(DISTINCT ce.claim_id) AS claim_count,
            (SELECT LISTAGG(a.alias_text, ', ') WITHIN GROUP (ORDER BY a.alias_text)
               FROM entity_aliases a
              WHERE a.entity_id = e.entity_id AND a.alias_text <> e.entity_name) AS aliases
       FROM entities e
       LEFT JOIN claim_entities ce ON ce.entity_id = e.entity_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY e.entity_id, e.entity_name, e.entity_type, e.description
      ORDER BY claim_count DESC, e.entity_name`,
    binds
  );
}
