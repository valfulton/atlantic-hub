/**
 * Pooled connection to shhdbite_hunterhoney.
 */
import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getHhDb(): mysql.Pool {
  if (pool) return pool;
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER_HH;
  const password = process.env.DB_PASS_HH;
  const database = process.env.DB_NAME_HH || 'shhdbite_hunterhoney';
  if (!host || !user || !password) {
    throw new Error('HH DB env vars missing (DB_HOST / DB_USER_HH / DB_PASS_HH)');
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
