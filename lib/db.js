import pg from 'pg';

const { Pool } = pg;

let pool;

/** ใช้ DATABASE_URL (Neon) — Neon บังคับ TLS จึงควรมี sslmode=require ใน URL */
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('ไม่พบตัวแปร DATABASE_URL');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return pool;
}

/** ใช้ในการทดสอบ: ฉีด pool จำลองแทนการต่อ Neon จริง */
export function setPool(p) {
  pool = p;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
