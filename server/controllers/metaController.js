import { getDashboard } from '../services/dashboardService.js';
import { listPlatforms, listCategories, listEntities } from '../services/metaService.js';
import { getLabOverview, runExampleQuery } from '../services/labService.js';
import config from '../config/index.js';
import { poolStatus, queryOne } from '../db/pool.js';
import { isWebSearchConfigured } from '../web-search/searchProvider.js';

export const dashboard = async (req, res) => res.json(await getDashboard());
export const platforms = async (req, res) => res.json(await listPlatforms());
export const categories = async (req, res) => res.json(await listCategories());
export const entities = async (req, res) => res.json(await listEntities(req.query));
export const lab = async (req, res) => res.json(await getLabOverview());
export const labQuery = async (req, res) => res.json(await runExampleQuery(String(req.params.key)));

export const health = async (req, res) => {
  let database = 'down';
  try {
    await queryOne('SELECT 1 AS ok FROM dual');
    database = 'up';
  } catch {
    database = 'down';
  }
  const pool = poolStatus();
  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    webSearch: isWebSearchConfigured() ? 'configured' : 'not configured',
    uptimeSeconds: Math.round(process.uptime()),
    // Connection details stay out of public responses
    pool: config.isProduction ? { connected: pool.connected } : pool,
    time: new Date().toISOString(),
  });
};
