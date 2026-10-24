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

const env = (process.env.NODE_ENV || 'development').trim().toLowerCase();
const isProduction = env === 'production';

const config = {
  env,
  isProduction,
  port: int(process.env.PORT, 3000),
  // Number of reverse proxies in front of Express (Nginx = 1). Needed so the
  // rate limiter sees the visitor's address instead of the proxy's.
  trustProxy: int(process.env.TRUST_PROXY, isProduction ? 1 : 0),
  // Write/admin endpoints. With ADMIN_TOKEN set they require
  // "Authorization: Bearer <ADMIN_TOKEN>". Without it they are open in
  // development and disabled in production.
  adminToken: (process.env.ADMIN_TOKEN || '').trim(),
  rateLimit: {
    windowMinutes: Math.max(1, int(process.env.RATE_LIMIT_WINDOW_MINUTES, 15)),
    maxRequests: Math.max(10, int(process.env.RATE_LIMIT_MAX, 300)),
    // Live web investigations use paid search credits. The strict limits apply
    // to a public deployment; on a local machine (demo, review) they are relaxed.
    investigateWindowMinutes: Math.max(1, int(process.env.INVESTIGATE_RATE_WINDOW_MINUTES, 60)),
    investigateMaxPerIp: Math.max(1, int(process.env.INVESTIGATE_RATE_MAX, isProduction ? 10 : 500)),
    investigateDailyLimit: Math.max(0, int(process.env.INVESTIGATE_DAILY_LIMIT, isProduction ? 100 : 0)),
  },
  // Browser origins allowed to call the API cross-origin. Behind the bundled
  // Nginx the site is same-origin, so production can leave this empty.
  corsOrigins: (process.env.CORS_ORIGINS ?? (isProduction ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
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
    provider: (process.env.WEB_SEARCH_PROVIDER || 'tavily').trim().toLowerCase(),
    // Read only on the server. Never sent to the browser.
    tavilyApiKey: (process.env.TAVILY_API_KEY || '').trim(),
    tavilyEndpoint: process.env.TAVILY_SEARCH_ENDPOINT || 'https://api.tavily.com/search',
    // One basic search per investigation; Tavily returns at most 20 results per request.
    maxResults: Math.min(20, Math.max(1, int(process.env.WEB_SEARCH_MAX_RESULTS, 20))),
    fetchTimeoutMs: int(process.env.WEB_FETCH_TIMEOUT_MS, 9000),
    fetchMaxBytes: int(process.env.WEB_FETCH_MAX_BYTES, 1_500_000),
    fetchConcurrency: Math.min(6, Math.max(1, int(process.env.WEB_FETCH_CONCURRENCY, 5))),
    respectRobots: bool(process.env.WEB_FETCH_RESPECT_ROBOTS, true),
    // Only for local testing against a mock server. Keep false.
    allowPrivateHosts: !isProduction && bool(process.env.WEB_FETCH_ALLOW_PRIVATE, false),
  },
};

export default config;
