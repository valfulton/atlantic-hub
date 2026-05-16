/**
 * Pooled connection to shhdbite_eventsbywater.
 *
 * Backs the Events by Water tab. Reads 7 form tables the EBW website
 * writes via form_handler.php (charter_inquiries, captain_applications,
 * vessel_listings, investor_registrations, ethics_invitations,
 * jet_inquiries, speaker_applications) plus 3 atlantic-hub-managed tables
 * from schema/005_ebw_detail.sql (bookings, revenue_entries, marketing_activity).
 *
 * Env vars required in Netlify Site Environment Variables:
 *   DB_HOST, DB_PORT      — shared with the platform pool
 *   DB_USER_EBW, DB_PASS_EBW — EBW-scoped MySQL user (read/write on shhdbite_eventsbywater only)
 *   DB_NAME_EBW           — defaults to 'shhdbite_eventsbywater'
 */
import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getEbwDb(): mysql.Pool {
  if (pool) return pool;
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER_EBW;
  const password = process.env.DB_PASS_EBW;
  const database = process.env.DB_NAME_EBW || 'shhdbite_eventsbywater';
  if (!host || !user || !password) {
    throw new Error('EBW DB env vars missing (DB_HOST / DB_USER_EBW / DB_PASS_EBW)');
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
