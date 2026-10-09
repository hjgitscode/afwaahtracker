/**
 * Upgrades an EXISTING AfwaahTracker database to the current schema without
 * deleting any data. Runs database/10_web_investigation.sql (adds what is
 * missing and re-links automatic claim lineage with the evidence-based rules)
 * and 11_tavily_provider.sql (Tavily as the web search provider).
 *
 * Usage:  npm run db:migrate            (from the server folder or the root)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, runFiles } from './installDb.js';

export const MIGRATIONS = ['10_web_investigation.sql', '11_tavily_provider.sql'];

async function main() {
  const conn = await connect();
  try {
    await runFiles(conn, MIGRATIONS);
    const r = await conn.execute(
      `SELECT (SELECT COUNT(*) FROM claims), (SELECT COUNT(*) FROM sources),
              (SELECT COUNT(*) FROM web_search_runs), (SELECT COUNT(*) FROM source_references) FROM dual`
    );
    const [c, s, w, ref] = r.rows[0];
    console.log(`\nDatabase is up to date: ${c} claims, ${s} sources, ${w} web search runs, ${ref} source references.`);
  } finally {
    await conn.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nMigration failed: ${err.message}`);
    console.error('Check that Oracle is running and that server/.env holds the right DB_USER / DB_PASSWORD / DB_CONNECT_STRING.');
    process.exit(1);
  });
}
