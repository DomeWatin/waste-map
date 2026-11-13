import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './lib/db.js';
import { rowsToGeoJSON, zonesToGeoJSON } from './lib/kml.js';
import { ensureSchema, runSync } from './lib/sync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(compression());

// สำหรับ health check ของ Render (ไม่แตะฐานข้อมูล)
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ค่าตั้งต้นฝั่งหน้าเว็บ (LIFF ID ไม่ใช่ความลับ — LINE แสดงอยู่ใน URL ของ LIFF อยู่แล้ว)
app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ liffId: process.env.LIFF_ID || null });
});

app.get('/api/points.geojson', async (_req, res) => {
  try {
    const { rows } = await getPool().query(
      'SELECT uid, layer, name, description, lng, lat, props, photo_count FROM waste_points ORDER BY layer, name',
    );
    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/geo+json').send(JSON.stringify(rowsToGeoJSON(rows)));
  } catch (e) {
    console.error('[points]', e.message);
    res.status(500).json({ error: 'อ่านข้อมูลไม่สำเร็จ' });
  }
});

// เขตชุมชน (พื้นที่)
app.get('/api/zones.geojson', async (_req, res) => {
  try {
    const { rows } = await getPool().query(
      'SELECT uid, district, name, description, geom FROM waste_zones ORDER BY district, name',
    );
    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/geo+json').send(JSON.stringify(zonesToGeoJSON(rows)));
  } catch (e) {
    console.error('[zones]', e.message);
    res.status(500).json({ error: 'อ่านเขตชุมชนไม่สำเร็จ' });
  }
});

// รูปถ่ายของจุดเดียว (หน้าเว็บเรียกตอนผู้ใช้กดเปิดป๊อปอัป)
app.get('/api/point-photos', async (req, res) => {
  const id = String(req.query.id ?? '');
  if (!id || id.length > 500) return res.status(400).json({ error: 'bad id' });
  try {
    const { rows } = await getPool().query('SELECT images FROM waste_points WHERE uid = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.set('Cache-Control', 'public, max-age=300').json({ images: rows[0].images ?? [] });
  } catch (e) {
    console.error('[photos]', e.message);
    res.status(500).json({ error: 'อ่านรูปไม่สำเร็จ' });
  }
});

app.get('/api/status', async (_req, res) => {
  try {
    const pool = getPool();
    const [points, zones, last, lastOk, lastChanged] = await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM waste_points'),
      pool.query('SELECT count(*)::int AS n FROM waste_zones'),
      pool.query(
        'SELECT finished_at, ok, message FROM sync_log WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1',
      ),
      pool.query('SELECT finished_at FROM sync_log WHERE ok ORDER BY id DESC LIMIT 1'),
      pool.query('SELECT finished_at FROM sync_log WHERE ok AND changed ORDER BY id DESC LIMIT 1'),
    ]);
    // lastCheckedAt = ครั้งล่าสุดที่ตรวจแผนที่สำเร็จ (แม้ไม่มีอะไรเปลี่ยน), lastChangedAt = ครั้งล่าสุดที่ข้อมูลเปลี่ยนจริง
    const lastCheckedAt = lastOk.rows[0]?.finished_at ?? null;
    // รอบละ 3 ชม. — เกิน 7 ชม. (พลาดไป 2 รอบ) ถือว่าข้อมูลอาจเก่า ปรับได้ด้วย STALE_AFTER_HOURS
    const staleHours = Number(process.env.STALE_AFTER_HOURS) || 7;
    const stale = !lastCheckedAt || Date.now() - new Date(lastCheckedAt).getTime() > staleHours * 3600_000;
    res.set('Cache-Control', 'no-store').json({
      points: points.rows[0].n,
      zones: zones.rows[0].n,
      lastCheckedAt,
      lastChangedAt: lastChanged.rows[0]?.finished_at ?? null,
      stale,
      lastSync: last.rows[0] ?? null,
    });
  } catch (e) {
    console.error('[status]', e.message);
    res.status(500).json({ error: 'อ่านสถานะไม่สำเร็จ' });
  }
});

// สั่งดึงข้อมูลด้วยมือ (ป้องกันด้วย SYNC_TOKEN) เช่น curl -X POST -H "x-sync-token: ..." .../api/sync
app.post('/api/sync', async (req, res) => {
  const token = process.env.SYNC_TOKEN;
  if (!token || req.get('x-sync-token') !== token) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    res.json(await runSync(undefined, { force: req.query.force === '1' }));
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.use(express.static(path.join(here, 'public'), { maxAge: '5m' }));

try {
  await ensureSchema();
} catch (e) {
  console.error('[startup] สร้างตารางไม่สำเร็จ:', e.message);
}

app.listen(port, '0.0.0.0', () => console.log(`เปิดที่พอร์ต ${port}`));
