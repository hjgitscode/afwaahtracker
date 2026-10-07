/** Quick connectivity check: npm run db:check */
import oracledb from 'oracledb';
import config from '../config/index.js';

try {
  const conn = await oracledb.getConnection({ user: config.db.user, password: config.db.password, connectString: config.db.connectString });
  const r = await conn.execute(`SELECT (SELECT COUNT(*) FROM claims) AS claims, (SELECT COUNT(*) FROM sources) AS sources FROM dual`);
  console.log(`Connected to ${config.db.connectString} as ${config.db.user}. Claims: ${r.rows[0][0]}, sources: ${r.rows[0][1]}.`);
  await conn.close();
} catch (err) {
  console.error(`Could not query AfwaahTracker tables: ${err.message}`);
  process.exit(1);
}
