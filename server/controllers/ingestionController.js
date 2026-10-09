import { getIngestionStatus } from '../services/ingestionService.js';
import { triggerIngestion } from '../ingestion/scheduler.js';
import { getConnection } from '../db/pool.js';

export const status = async (req, res) => res.json(await getIngestionStatus());

/**
 * Fetches every enabled ingestion source now. The request waits for the
 * run to finish (or joins the run already in progress) and returns the summary.
 */
export const refresh = async (req, res) => {
  // Fail fast with a clear 503 when Oracle is unreachable
  const conn = await getConnection();
  await conn.close();

  const results = await triggerIngestion({ force: true, trigger: 'manual' });
  const totals = results.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      inserted: acc.inserted + r.inserted,
      skipped: acc.skipped + r.skipped,
      matched: acc.matched + r.matched,
      failed: acc.failed + (r.status === 'FAILED' ? 1 : 0),
    }),
    { fetched: 0, inserted: 0, skipped: 0, matched: 0, failed: 0 }
  );
  res.json({ completedAt: new Date().toISOString(), totals, results });
};
