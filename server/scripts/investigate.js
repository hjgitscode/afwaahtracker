/**
 * Runs one live web investigation from the command line (the same pipeline as
 * INVESTIGATE WEB) and prints its novelty diagnostics, counted in Oracle.
 *
 * Usage:  npm run investigate -- "Is GV Selvam director of VIT?"
 *         npm run investigate -- --run 42        (diagnostics of a past run)
 *         npm run investigate -- --claim 305     (diagnostics of one family)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initPool, closePool, query } from '../db/pool.js';
import { investigateWeb } from '../web-search/webInvestigator.js';
import { getRunDiagnostics } from '../services/webSearchService.js';
import { getNoveltyDiagnostics } from '../services/claimService.js';

const LINES = [
  ['sourceCount', 'sources'],
  ['datedSourceCount', 'sources with a publication date'],
  ['evidenceCount', 'evidence sentences (linked to variants)'],
  ['variantCount', 'variants'],
  ['structuredVariantCount', 'structured variants'],
  ['variantsWithParent', 'variants with parent'],
  ['claimLineageEdges', 'claim-lineage edges'],
  ['mutationCount', 'mutations'],
  ['sourceReferenceCount', 'source references'],
  ['sourceLineageEdges', 'source-lineage edges'],
  ['sourcesWithKnownUpstream', 'known upstream sources'],
];

function printFamily(f) {
  console.log(`\n#${f.claimId} ${f.canonicalClaim || ''}${f.relationshipToQuery ? `  [${f.relationshipToQuery}]` : ''}${f.status === 'MERGED' ? `  [MERGED into #${f.mergedIntoClaimId}]` : ''}`);
  if (f.normalizedSignature) console.log(`  signature ${f.normalizedSignature}`);
  for (const [key, label] of LINES) console.log(`  ${label.padEnd(42, '.')} ${f[key]}`);
  console.log(`  ${'Known Echo Ratio'.padEnd(42, '.')} ${f.knownEchoRatio}%`);
}

function printRun(d) {
  console.log(`\nRun #${d.searchRunId} "${d.query}" — ${d.status}${d.error ? ` (${d.error})` : ''}`);
  if (d.hypothesis) console.log(`Investigated hypothesis: ${d.hypothesis}`);
  else console.log(`Query type: ${d.queryType || 'TOPIC_SEARCH'} (no hypothesis)`);
  console.log('\nPipeline stages (SEARCH_RUN_STAGES):');
  for (const s of d.stages) console.log(`  ${s.stage.padEnd(13)} examined ${String(s.examined).padStart(4)}  wrote ${String(s.written).padStart(4)}  ${s.detail || ''}`);
  if (d.stagesNotRun.length) console.log(`  NOT RUN: ${d.stagesNotRun.join(', ')}`);
  console.log('\nRun totals:');
  for (const [key, value] of Object.entries(d.run)) console.log(`  ${key.padEnd(28, '.')} ${value}`);
  console.log('\nClaim families found:');
  if (!d.families.length) console.log('  none');
  d.families.forEach(printFamily);
}

async function main() {
  const args = process.argv.slice(2);
  await initPool();
  try {
    const flag = (name) => {
      const i = args.indexOf(name);
      return i >= 0 ? Number(args[i + 1]) : null;
    };
    if (flag('--claim')) {
      const d = await getNoveltyDiagnostics(flag('--claim'));
      printFamily(d);
      console.log('\nSources (CLAIM_VARIANTS + SOURCES + SOURCE_EVIDENCE):');
      const rows = await query(
        `SELECT v.source_id, s.publisher, s.published_at, s.source_title, v.relation_subject, v.relation_predicate,
                v.relation_object, v.relation_qualifier, v.lineage_basis, e.extraction_method, e.sentence_text,
                (SELECT LISTAGG(v2.claim_id, ',') WITHIN GROUP (ORDER BY v2.claim_id) FROM claim_variants v2
                  WHERE v2.source_id = v.source_id AND v2.claim_id <> v.claim_id) AS other_claims,
                (SELECT COUNT(*) FROM source_evidence e2 WHERE e2.source_id = v.source_id) AS stored_sentences
           FROM claim_variants v JOIN sources s ON s.source_id = v.source_id
           LEFT JOIN source_evidence e ON e.evidence_id = v.evidence_id
          WHERE v.claim_id = :id ORDER BY s.published_at NULLS LAST, v.source_id`,
        { id: flag('--claim') }
      );
      for (const r of rows) {
        console.log(`  source #${r.source_id} ${r.publisher || ''} ${r.published_at ? new Date(r.published_at).toISOString().slice(0, 10) : 'undated'}`
          + `${r.other_claims ? `  (also in claims ${r.other_claims})` : ''}`);
        console.log(`    title: ${String(r.source_title || '').slice(0, 120)}`);
        console.log(`    evidence: ${r.sentence_text ? `[${r.extraction_method}] ${r.sentence_text.slice(0, 160)}` : `none linked (${r.stored_sentences} sentences stored for this source)`}`);
        console.log(`    structure: ${r.relation_predicate ? `${r.relation_subject} | ${r.relation_predicate} | ${r.relation_object} | ${r.relation_qualifier || '-'}` : 'none'}; parent basis ${r.lineage_basis}`);
      }
      console.log(`\nStages of the investigations that touched it:`);
      for (const s of d.stages) console.log(`  run #${s.search_run_id} ${s.stage_code.padEnd(13)} examined ${s.items_examined} wrote ${s.rows_written}  ${s.detail || ''}`);
      return;
    }
    let runId = flag('--run');
    if (!runId) {
      const text = args.filter((a) => !a.startsWith('--')).join(' ').trim();
      if (!text) throw new Error('Give a query, e.g. npm run investigate -- "Is GV Selvam director of VIT?"');
      console.log(`Investigating "${text}" ...`);
      runId = (await investigateWeb(text)).searchRunId;
    }
    printRun(await getRunDiagnostics(runId));
    if (args.includes('--json')) console.log(JSON.stringify(await getRunDiagnostics(runId), null, 2));
  } finally {
    await closePool();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
