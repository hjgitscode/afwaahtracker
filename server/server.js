import config from './config/index.js';
import { createApp } from './app.js';
import { initPool, closePool } from './db/pool.js';
import { startScheduler, stopScheduler } from './ingestion/scheduler.js';
import { log } from './middleware/logger.js';

// A public deployment must never run on the development defaults
if (config.isProduction && !process.env.DB_PASSWORD) {
  log.error('DB_PASSWORD is not set. Refusing to start in production with the default password.');
  process.exit(1);
}

const app = createApp();

async function main() {
  try {
    await initPool();
    log.info('connection pool ready', { connectString: config.db.connectString });
  } catch (err) {
    // The API still starts; requests return a friendly 503 and the pool
    // is retried automatically on the next request.
    log.warn('Oracle not reachable yet', { detail: err.message.split('\n')[0] });
  }

  const server = app.listen(config.port, () => {
    log.info(`AfwaahTracker API listening on port ${config.port}`, {
      env: config.env,
      webSearch: config.webSearch.tavilyApiKey ? 'configured' : 'not configured',
      adminEndpoints: config.adminToken ? 'token' : config.isProduction ? 'disabled' : 'open (development)',
    });
  });

  startScheduler();

  const shutdown = async (signal) => {
    log.info(`${signal} received, shutting down`);
    stopScheduler();
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { detail: String(err?.message || err).split('\n')[0] }));
}

main();
