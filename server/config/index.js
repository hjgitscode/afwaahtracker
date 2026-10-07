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
};

export default config;
