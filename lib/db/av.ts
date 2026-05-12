/**
 * Pooled connection to shhdbite_av.
 *
 * Backs the Atlantic & Vine tab (LinkedIn lead pipeline + client portal).
 * Schema lives in schema/004_av_detail.sql; tables: clients,
 * pipeline_stages, leads, lead_notes, lead_events (+ 3 dormant tables
 * for the v2 digest-email feature).
 *
 * Env vars required (set in Netlify Site Environment Variables):
 *   DB_HOST, DB_PORT — shared with the platform pool
 *   DB_USER_AV, DB_PASS_AV — AV-scoped MySQL user (read/write on shhdbite_av only)
 *   DB_NAME_AV — defaults to 'shhdbite_av'
 *
 * The throw on missing env vars is intentional: it surfaces a 500 with a
 * legible error class instead of a silent connection-refused at query time.
 */
import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getAvDb(): mysql.Pool {
  if (pool) return pool;
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER_AV;
  const password = process.env.DB_PASS_AV;
  const database = process.env.DB_NAME_AV || 'shhdbite_AV';
  if (!host || !user || !password) {
    throw new Error('AV DB env vars missing (DB_HOST / DB_USER_AV / DB_PASS_AV)');
  }
  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    timezone: '+00:00',
    charset: 'utf8mb4_unicode_ci'
  });
  return pool;
}
