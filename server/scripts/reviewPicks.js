/**
 * Picks, from what Oracle actually holds, the claim families that best show
 * each analysis layer for a review. Nothing is created or changed.
 *
 *   A  extraction + Claim Variation      live family, >= 2 structured versions that differ
 *   B  Claim Lineage + Mutation Ledger   live family with parent links and ledger rows
 *   C  Source Lineage + Known Echo Ratio live family with a RESOLVED upstream dependency
 *   S  Stated provenance                 live family whose pages credit another publisher
 * If no live family qualifies for B or C, the best DEMO family is listed and
 * marked DEMO (curated demonstration data).
 *
 * Usage:  npm run review-picks
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initPool, closePool, query } from '../db/pool.js';

const BASE = `SELECT d.*, c.canonical_claim, c.claim_origin
                FROM vw_claim_novelty_diagnostics d JOIN claims c ON c.claim_id = d.claim_id
               WHERE c.status <> 'MERGED'`;

const PICKS = [
  ['A', 'Claim extraction + Claim Variation',
    `${BASE} AND c.claim_origin <> 'DEMO' AND d.has_proposition = 'Y' AND d.structured_variant_count >= 2 AND d.has_variation > 0
      ORDER BY d.structured_variant_count DESC, d.evidence_count DESC, d.claim_id DESC`],
  ['B', 'Claim Lineage + Mutation Ledger',
    `${BASE} AND d.claim_lineage_edges > 0 AND d.mutation_count > 0
      ORDER BY CASE c.claim_origin WHEN 'DEMO' THEN 1 ELSE 0 END, d.mutation_count DESC, d.claim_id DESC`],
  ['C', 'Source Lineage + Known Echo Ratio (resolved dependency)',
    `${BASE} AND d.sources_with_known_upstream > 0
      ORDER BY CASE c.claim_origin WHEN 'DEMO' THEN 1 ELSE 0 END, d.sources_with_known_upstream DESC, d.claim_id DESC`],
  ['S', 'Stated provenance (credits, resolved or not)',
    `${BASE} AND c.claim_origin <> 'DEMO' AND d.stated_attribution_count > 0
      ORDER BY d.resolved_attribution_count DESC, d.stated_attribution_count DESC, d.claim_id DESC`],
];

async function main() {
  await initPool();
  try {
    for (const [key, label, sql] of PICKS) {
      const rows = await query(`${sql} FETCH FIRST 3 ROWS ONLY`);
      console.log(`\n${key}. ${label}`);
      if (!rows.length) {
        console.log('   none in this database yet');
        continue;
      }
      for (const r of rows) {
        const demo = r.claim_origin === 'DEMO' ? '  [DEMO data]' : '';
        console.log(`   #${r.claim_id} ${r.canonical_claim}${demo}`);
        console.log(`      http://localhost:5173/claims/${r.claim_id}`);
        console.log(`      sources ${r.source_count} · structured versions ${r.structured_variant_count} · dated ${r.dated_variant_count}`
          + ` · parents ${r.variants_with_parent} · mutations ${r.mutation_count}`
          + ` · stated credits ${r.stated_attribution_count} (resolved ${r.resolved_attribution_count})`
          + ` · known upstream ${r.sources_with_known_upstream} · Known Echo Ratio ${r.known_echo_ratio}%`);
      }
    }
  } finally {
    await closePool();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n${err.message}`);
    console.error('Run "npm run db:migrate" first, and check that Oracle is running.');
    process.exit(1);
  });
}
