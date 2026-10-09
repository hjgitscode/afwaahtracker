/**
 * Installs the AfwaahTracker schema using node-oracledb, for machines where
 * SQL*Plus is not available. It reads database/install.sql, runs every
 * "@@file.sql" it references in the same order, and understands the subset
 * of SQL*Plus syntax used by those scripts:
 *   - SQL statements terminated by ";"
 *   - PL/SQL blocks / CREATE FUNCTION|PROCEDURE|TRIGGER terminated by "/"
 *   - SQL*Plus commands (SET, PROMPT, WHENEVER, SHOW, COLUMN, EXIT) are skipped
 *
 * Usage:  npm run db:install            (from the server folder or the root)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import oracledb from 'oracledb';
import config from '../config/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '..', '..', 'database');

const SQLPLUS_CMD = /^(SET|PROMPT|WHENEVER|SHOW|COLUMN|COL|SPOOL|EXIT|REM|REMARK|TTITLE|BTITLE|BREAK|CLEAR)\b/i;
const PLSQL_START = /^(CREATE\s+(OR\s+REPLACE\s+)?(EDITIONABLE\s+)?(FUNCTION|PROCEDURE|TRIGGER|PACKAGE|TYPE)\b|DECLARE\b|BEGIN\b)/i;

export function splitScript(text) {
  const statements = [];
  let buf = [];
  let plsql = false;
  const flush = () => {
    const sql = buf.join('\n').trim();
    if (sql) statements.push({ sql, plsql });
    buf = [];
    plsql = false;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!buf.length) {
      if (!trimmed || trimmed.startsWith('--') || SQLPLUS_CMD.test(trimmed) || trimmed.startsWith('@')) continue;
      if (trimmed === '/') continue;
      plsql = PLSQL_START.test(trimmed);
    }
    if (plsql) {
      if (trimmed === '/') {
        flush();
        continue;
      }
      buf.push(line);
    } else {
      buf.push(line);
      if (trimmed.endsWith(';') && !trimmed.startsWith('--')) {
        buf[buf.length - 1] = line.replace(/;\s*$/, '');
        flush();
      }
    }
  }
  flush();
  return statements;
}

export async function connect() {
  console.log(`Connecting to ${config.db.connectString} as ${config.db.user} ...`);
  return oracledb.getConnection({
    user: config.db.user,
    password: config.db.password,
    connectString: config.db.connectString,
  });
}

/** Runs the given database/*.sql files in order, then recompiles the schema. */
export async function runFiles(conn, files) {
  for (const file of files) {
    const statements = splitScript(fs.readFileSync(path.join(dbDir, file), 'utf8'));
    process.stdout.write(`  ${file.padEnd(28)} ${String(statements.length).padStart(4)} statements ... `);
    for (const st of statements) {
      try {
        await conn.execute(st.sql);
      } catch (err) {
        console.log('FAILED');
        console.error(`\nStatement in ${file} failed:\n${st.sql.slice(0, 400)}\n\n${err.message}`);
        await conn.rollback().catch(() => {});
        process.exit(1);
      }
    }
    await conn.commit();
    console.log('ok');
  }
  await conn.execute(`BEGIN DBMS_UTILITY.COMPILE_SCHEMA(schema => USER, compile_all => FALSE); END;`);
  const invalid = await conn.execute(
    `SELECT object_type || ' ' || object_name FROM user_objects WHERE status <> 'VALID' ORDER BY 1`
  );
  if (invalid.rows.length) {
    console.error(`\nInvalid objects after install: ${invalid.rows.map((r) => r[0]).join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  const install = fs.readFileSync(path.join(dbDir, 'install.sql'), 'utf8');
  const files = [...install.matchAll(/^@@(\S+)/gm)].map((m) => m[1]);
  const conn = await connect();

  try {
    await runFiles(conn, files);
    const objects = await conn.execute(
      `SELECT object_type, COUNT(*) AS total, SUM(CASE WHEN status = 'VALID' THEN 1 ELSE 0 END) AS valid
         FROM user_objects
        WHERE object_type IN ('TABLE','VIEW','PROCEDURE','FUNCTION','TRIGGER','INDEX')
        GROUP BY object_type ORDER BY object_type`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log('\nInstalled objects:');
    objects.rows.forEach((r) => console.log(`  ${r.OBJECT_TYPE.padEnd(10)} ${r.TOTAL} (${r.VALID} valid)`));
    const counts = await conn.execute(
      `SELECT (SELECT COUNT(*) FROM claims) c, (SELECT COUNT(*) FROM sources) s,
              (SELECT COUNT(*) FROM claim_variants) v, (SELECT COUNT(*) FROM claim_mutations) m FROM dual`
    );
    const [c, s, v, m] = counts.rows[0];
    console.log(`\nSeed data: ${c} claims, ${s} sources, ${v} variants, ${m} mutation-ledger rows.`);
    console.log('AfwaahTracker database installed successfully.');
  } finally {
    await conn.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nInstallation failed: ${err.message}`);
    console.error('Check that Oracle is running and that DB_USER / DB_PASSWORD / DB_CONNECT_STRING in server/.env are correct.');
    process.exit(1);
  });
}
