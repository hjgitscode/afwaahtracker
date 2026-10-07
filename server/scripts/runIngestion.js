/** One-off ingestion run from the command line: npm run ingest */
import { runIngestion } from '../ingestion/pipeline.js';
import { closePool } from '../db/pool.js';

try {
  const results = await runIngestion({ force: true });
  console.table(results.map(({ sourceName, status, fetched, inserted, skipped, matched }) => ({ sourceName, status, fetched, inserted, skipped, matched })));
} catch (err) {
  console.error(`Ingestion failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
