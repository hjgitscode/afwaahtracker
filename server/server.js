import config from './config/index.js';
import { createApp } from './app.js';
import { initPool, closePool } from './db/pool.js';
import { startScheduler, stopScheduler } from './ingestion/scheduler.js';

const app = createApp();

async function main() {
  try {
    await initPool();
    console.log(`[db] connection pool ready (${config.db.connectString})`);
  } catch (err) {
    // The API still starts; requests return a friendly 503 and the pool
    // is retried automatically on the next request.
    console.warn(`[db] Oracle not reachable yet: ${err.message.split('\n')[0]}`);
  }

  const server = app.listen(config.port, () => {
    console.log(`[api] AfwaahTracker API listening on http://localhost:${config.port}`);
  });

  startScheduler();

  const shutdown = async (signal) => {
    console.log(`[api] ${signal} received, shutting down`);
    stopScheduler();
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
