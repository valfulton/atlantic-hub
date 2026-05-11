/**
 * Pooled connection to shhdbite_ebw.
 * STUB IN V1 — EBW tab ships in v2.
 */
import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getEbwDb(): mysql.Pool {
  if (pool) return pool;
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER_EBW;
  const password = process.env.DB_PASS_EBW;
  const database = process.env.DB_NAME_EBW || 'shhdbite_ebw';
  if (!host || !user || !password) {
    throw new Error('EBW DB env vars not yet configured (v2 feature)');
  }
  pool = mysql.createPool({
    host, port, user, password, database,
    waitForConnections: true, connectionLimit: 5, queueLimit: 0,
    enableKeepAlive: true, keepAliveInitialDelay: 10_000,
    timezone: '+00:00', charset: 'utf8mb4_unicode_ci'
  });
  return pool;
}
