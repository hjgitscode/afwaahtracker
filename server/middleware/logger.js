/**
 * Request and application logging.
 * Production writes one JSON line per event (easy to read with
 * `docker compose logs`). Secrets are never logged: request bodies, headers
 * and query strings are not written, and known secret values are masked in
 * any message.
 */
import config from '../config/index.js';

const SECRETS = [process.env.TAVILY_API_KEY, process.env.DB_PASSWORD, process.env.ADMIN_TOKEN, process.env.ORACLE_PASSWORD]
  .map((v) => (v || '').trim())
  .filter((v) => v.length >= 4);

export function redact(text) {
  let out = String(text ?? '');
  for (const s of SECRETS) out = out.split(s).join('[redacted]');
  return out;
}

function write(level, msg, fields = {}) {
  if (config.isProduction) {
    const line = { time: new Date().toISOString(), level, msg: redact(msg) };
    for (const [k, v] of Object.entries(fields)) line[k] = typeof v === 'string' ? redact(v) : v;
    (level === 'error' || level === 'warn' ? console.error : console.log)(JSON.stringify(line));
  } else {
    const extra = Object.keys(fields).length ? ` ${redact(JSON.stringify(fields))}` : '';
    (level === 'error' || level === 'warn' ? console.error : console.log)(`[${level}] ${redact(msg)}${extra}`);
  }
}

export const log = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};

/** One line per API request: method, path (without query string), status, duration. */
export function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (!config.isProduction && res.statusCode < 400) return; // keep development output quiet
    if (req.path === '/api/health' && res.statusCode < 400) return; // container health checks
    write(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'request', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms),
      ip: req.ip,
    });
  });
  next();
}
