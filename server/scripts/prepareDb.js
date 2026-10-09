/**
 * Run at container start (DB_PREPARE_ON_START=true):
 *   - empty schema      -> full install (schema + demonstration data)
 *   - existing schema   -> only the idempotent migrations; no data is reset
 * Waits for Oracle to accept connections first.
 *
 * Usage:  node scripts/prepareDb.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, runFiles } from './installDb.js';
import { MIGRATIONS } from './migrateDb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '..', '..', 'database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectWithRetry(attempts = 60) {
  for (let i = 1; ; i += 1) {
    try {
      return await connect();
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`Oracle not ready yet (${err.message.split('\n')[0]}), retrying in 5 s ...`);
      await sleep(5000);
    }
  }
}

async function main() {
  const conn = await connectWithRetry();
  try {
    const r = await conn.execute(`SELECT COUNT(*) FROM user_tables WHERE table_name = 'CLAIMS'`);
    if (r.rows[0][0] === 0) {
      console.log('Empty schema: installing AfwaahTracker ...');
      const install = fs.readFileSync(path.join(dbDir, 'install.sql'), 'utf8');
      await runFiles(conn, [...install.matchAll(/^@@(\S+)/gm)].map((m) => m[1]));
    } else {
      console.log('Existing schema: applying migrations (data is kept) ...');
      await runFiles(conn, MIGRATIONS);
    }
    console.log('Database ready.');
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error(`Database preparation failed: ${err.message.split('\n')[0]}`);
  process.exit(1);
});
