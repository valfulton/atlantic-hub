/**
 * Pooled connection to shhdbite_atlantic_hub.
 * One pool per Lambda warm instance. Auto-reconnects.
 */
import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getPlatformDb(): mysql.Pool {
  if (pool) return pool;
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER_PLATFORM;
  const password = process.env.DB_PASS_PLATFORM;
  const database = process.env.DB_NAME_PLATFORM || 'shhdbite_atlantic_hub';
  if (!host || !user || !password) {
    throw new Error('Platform DB env vars missing (DB_HOST / DB_USER_PLATFORM / DB_PASS_PLATFORM)');
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
