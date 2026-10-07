/**
 * Error types and the Express error handler. Raw stack traces and SQL are
 * never sent to the client; they are logged on the server instead.
 */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'The requested record was not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ValidationError extends HttpError {
  constructor(message, details) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class DatabaseUnavailableError extends HttpError {
  constructor(cause) {
    super(
      503,
      'DB_UNAVAILABLE',
      'The Oracle database is not reachable. Check that Oracle is running and that server/.env is correct.'
    );
    this.cause = cause;
  }
}

// ORA codes that mean "the database cannot be reached right now"
const CONNECTIVITY_CODES = new Set([
  'NJS-500', 'NJS-501', 'NJS-503', 'NJS-510', 'NJS-511', 'NJS-518', 'NJS-521',
  'NJS-040', 'NJS-064', 'ORA-12541', 'ORA-12514', 'ORA-12528', 'ORA-01033',
  'ORA-01034', 'ORA-01017', 'ORA-12170', 'ORA-03113', 'ORA-03114', 'ORA-28000',
]);

function oracleCode(err) {
  if (!err) return null;
  if (err.code && /^(ORA|NJS|DPI)-/.test(err.code)) return err.code;
  const m = /^((?:ORA|NJS|DPI)-\d{3,5})/.exec(err.message || '');
  return m ? m[1] : null;
}

export function toHttpError(err) {
  if (err instanceof HttpError) return err;
  const code = oracleCode(err);
  if (code && CONNECTIVITY_CODES.has(code)) return new DatabaseUnavailableError(err);
  if (code && /^ORA-20\d{3}$/.test(code)) {
    // Application errors raised by our PL/SQL (RAISE_APPLICATION_ERROR)
    const msg = (err.message || '').split('\n')[0].replace(/^ORA-\d+:\s*/, '');
    return new HttpError(400, 'BUSINESS_RULE', msg);
  }
  if (code === 'ORA-00001') return new HttpError(409, 'DUPLICATE', 'A record with the same unique value already exists.');
  if (code === 'ORA-02291') return new HttpError(400, 'INVALID_REFERENCE', 'A referenced record does not exist.');
  if (code === 'ORA-02290') return new HttpError(400, 'CHECK_FAILED', 'A value is outside its allowed range.');
  if (code === 'ORA-01400') return new HttpError(400, 'MISSING_VALUE', 'A required value is missing.');
  if (code === 'ORA-12899') return new HttpError(400, 'VALUE_TOO_LONG', 'A value is longer than allowed.');
  return new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong while processing the request.');
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const httpErr = toHttpError(err);
  if (httpErr.status >= 500) {
    console.error(`[api] ${req.method} ${req.originalUrl} -> ${httpErr.code}:`, err.cause?.message || err.message);
  }
  res.status(httpErr.status).json({
    error: { code: httpErr.code, message: httpErr.message, details: httpErr.details },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.path}` } });
}

/** Wraps async route handlers so rejected promises reach the error handler. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
