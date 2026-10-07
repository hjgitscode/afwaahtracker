/**
 * Oracle connection pool (node-oracledb, Thin mode - no Instant Client needed).
 * Every query in the application goes through `query()` / `withTransaction()`
 * and uses bind variables; user input is never concatenated into SQL.
 */
import oracledb from 'oracledb';
import config from '../config/index.js';
import { DatabaseUnavailableError } from '../middleware/errors.js';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

let pool = null;
let connecting = null;
let lastError = null;

export async function initPool() {
  if (pool) return pool;
  if (connecting) return connecting;
  connecting = oracledb
    .createPool({
      user: config.db.user,
      password: config.db.password,
      connectString: config.db.connectString,
      poolMin: config.db.poolMin,
      poolMax: config.db.poolMax,
      poolIncrement: 1,
      poolPingInterval: 30,
      queueTimeout: 15000,
      connectTimeout: 10,
    })
    .then((p) => {
      pool = p;
      lastError = null;
      return p;
    })
    .catch((err) => {
      lastError = err;
      pool = null;
      throw err;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

export function poolStatus() {
  return {
    connected: Boolean(pool),
    connectionsOpen: pool ? pool.connectionsOpen : 0,
    connectionsInUse: pool ? pool.connectionsInUse : 0,
    lastError: lastError ? lastError.message : null,
  };
}

export async function getConnection() {
  try {
    const p = await initPool();
    return await p.getConnection();
  } catch (err) {
    throw new DatabaseUnavailableError(err);
  }
}

/** Lower-cases Oracle's upper-case column names for JSON responses. */
export function lowerKeys(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = v;
  return out;
}

function makeRunner(conn) {
  return {
    async rows(sql, binds = {}, options = {}) {
      const res = await conn.execute(sql, binds, options);
      return (res.rows || []).map(lowerKeys);
    },
    async one(sql, binds = {}, options = {}) {
      const res = await conn.execute(sql, binds, options);
      return res.rows && res.rows.length ? lowerKeys(res.rows[0]) : null;
    },
    async exec(sql, binds = {}, options = {}) {
      return conn.execute(sql, binds, options);
    },
    connection: conn,
  };
}

/** Run read queries on a pooled connection. */
export async function withConnection(fn) {
  const conn = await getConnection();
  try {
    return await fn(makeRunner(conn));
  } finally {
    await conn.close().catch(() => {});
  }
}

export async function query(sql, binds = {}, options = {}) {
  return withConnection((db) => db.rows(sql, binds, options));
}

export async function queryOne(sql, binds = {}, options = {}) {
  return withConnection((db) => db.one(sql, binds, options));
}

/**
 * Run `fn` inside a transaction: COMMIT on success, ROLLBACK on any error.
 */
export async function withTransaction(fn) {
  const conn = await getConnection();
  try {
    const result = await fn(makeRunner(conn));
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.close().catch(() => {});
  }
}

export async function closePool() {
  if (pool) {
    await pool.close(5).catch(() => {});
    pool = null;
  }
}

export { oracledb };
