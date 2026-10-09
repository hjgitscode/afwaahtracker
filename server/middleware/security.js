/**
 * Public-deployment safety:
 *   apiLimiter            general per-IP request limit for /api
 *   investigateLimiter    stricter per-IP limit for POST /api/investigate-web
 *   investigationQuota    site-wide daily cap on new web searches (protects
 *                         the search API credits; counted in Oracle so it
 *                         survives restarts)
 *   requireAdmin          write/admin endpoints: Bearer ADMIN_TOKEN, open in
 *                         development, disabled in production without a token
 */
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import config from '../config/index.js';
import { queryOne } from '../db/pool.js';
import { HttpError } from './errors.js';

const tooMany = (message) => (req, res) =>
  res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } });

export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  limit: config.rateLimit.maxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  handler: tooMany('Too many requests. Please wait a few minutes and try again.'),
});

export const investigateLimiter = rateLimit({
  windowMs: config.rateLimit.investigateWindowMinutes * 60 * 1000,
  limit: config.rateLimit.investigateMaxPerIp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany('You have started many web investigations recently. Please try again later, or explore the stored claim families.'),
});

export async function investigationQuota(req, res, next) {
  const limit = config.rateLimit.investigateDailyLimit;
  if (!limit) return next();
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS n FROM web_search_runs
        WHERE started_at >= TRUNC(SYSTIMESTAMP) AND status <> 'FAILED'`
    );
    if (row && row.n >= limit) {
      return res.status(429).json({
        error: {
          code: 'DAILY_LIMIT',
          message: 'The daily limit for live web investigations has been reached. Stored claim families can still be explored.',
        },
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

function sameToken(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function adminEnabled() {
  return Boolean(config.adminToken) || !config.isProduction;
}

export function requireAdmin(req, res, next) {
  if (config.adminToken) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token && sameToken(token, config.adminToken)) return next();
    return next(new HttpError(401, 'UNAUTHORIZED', 'This action requires administrator access.'));
  }
  if (!config.isProduction) return next();
  return next(new HttpError(403, 'FORBIDDEN', 'This action is not available on the public site.'));
}
