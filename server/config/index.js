import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEnv = path.resolve(here, '..', '.env');
const rootEnv = path.resolve(here, '..', '..', '.env');

// server/.env is the primary location; a root .env is accepted as a fallback.
dotenv.config({ path: fs.existsSync(serverEnv) ? serverEnv : rootEnv });

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const config = {
  port: int(process.env.PORT, 3000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    user: process.env.DB_USER || 'afwaah',
    password: process.env.DB_PASSWORD || 'afwaah',
    connectString: process.env.DB_CONNECT_STRING || 'localhost:1521/FREEPDB1',
    poolMin: int(process.env.DB_POOL_MIN, 1),
    poolMax: int(process.env.DB_POOL_MAX, 8),
  },
  ingestion: {
    enabled: bool(process.env.INGESTION_ENABLED, true),
    intervalMinutes: Math.max(5, int(process.env.INGESTION_INTERVAL_MINUTES, 60)),
    runOnStart: bool(process.env.INGESTION_RUN_ON_START, true),
    requestTimeoutMs: int(process.env.INGESTION_TIMEOUT_MS, 15000),
    userAgent: process.env.INGESTION_USER_AGENT || 'AfwaahTracker/1.0 (local claim provenance research tool)',
  },
  matching: {
    strongThreshold: int(process.env.MATCH_STRONG_THRESHOLD, 75),
    candidateThreshold: int(process.env.MATCH_CANDIDATE_THRESHOLD, 55),
  },
  webSearch: {
    // Read only on the server. Never sent to the browser.
    braveApiKey: (process.env.BRAVE_SEARCH_API_KEY || '').trim(),
    braveEndpoint: process.env.BRAVE_SEARCH_ENDPOINT || 'https://api.search.brave.com/res/v1/web/search',
    // Brave returns at most 20 results per request; 2 pages = up to 40 results.
    resultsPerPage: Math.min(20, Math.max(1, int(process.env.WEB_SEARCH_RESULTS_PER_PAGE, 20))),
    pages: Math.min(3, Math.max(1, int(process.env.WEB_SEARCH_PAGES, 2))),
    country: process.env.WEB_SEARCH_COUNTRY || '',
    fetchTimeoutMs: int(process.env.WEB_FETCH_TIMEOUT_MS, 9000),
    fetchMaxBytes: int(process.env.WEB_FETCH_MAX_BYTES, 1_500_000),
    fetchConcurrency: Math.min(6, Math.max(1, int(process.env.WEB_FETCH_CONCURRENCY, 5))),
    respectRobots: bool(process.env.WEB_FETCH_RESPECT_ROBOTS, true),
    // Only for local testing against a mock server. Keep false.
    allowPrivateHosts: bool(process.env.WEB_FETCH_ALLOW_PRIVATE, false),
  },
};

export default config;
