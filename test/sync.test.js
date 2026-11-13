import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { setPool, getPool } from '../lib/db.js';
import { ensureSchema, runSync } from '../lib/sync.js';

const pt = (name, lng, lat, desc = '') =>
  `<Placemark><name>${name}</name>${desc ? `<description>${desc}</description>` : ''}` +
  `<Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>`;
const zone = (name, x = 99.30, y = 9.10, d = 0.01) =>
  `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>` +
  `${x},${y},0 ${x + d},${y},0 ${x + d},${y + d},0 ${x},${y},0` +
  `</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
const kml = (points = '', zones = '') =>
  `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>` +
  `<Folder><name>ถังขยะทั่วไป</name>${points}</Folder>` +
  `<Folder><name>เขตพัฒนาชุมชนที่ 1</name>${zones}</Folder></Document></kml>`;

async function freshDb() {
  const { Pool } = newDb().adapters.createPg();
  setPool(new Pool());
  await ensureSchema();
  const q = (sql, params) => getPool().query(sql, params).then((r) => r.rows);
  return {
    q,
    count: async (t) => (await q(`SELECT count(*)::int AS n FROM ${t}`))[0].n,
    names: async (t) => (await q(`SELECT name FROM ${t} ORDER BY name`)).map((x) => x.name),
  };
}

test('รอบแรก: เพิ่มจุดและเขตชุมชนทั้งหมด', async () => {
  const db = await freshDb();
  const r = await runSync(kml(pt('A', 99.30, 9.10) + pt('B', 99.31, 9.11), zone('ชุมชน 1') + zone('ชุมชน 2')));
  assert.equal(r.changed, true);
  assert.deepEqual([r.points.added, r.points.changed, r.points.removed, r.points.total], [2, 0, 0, 2]);
  assert.deepEqual([r.zones.added, r.zones.changed, r.zones.removed, r.zones.total], [2, 0, 0, 2]);
  assert.equal(await db.count('waste_points'), 2);
  assert.equal(await db.count('waste_zones'), 2);
  const z = (await db.q('SELECT geom FROM waste_zones LIMIT 1'))[0].geom;
  assert.equal(z.type, 'Polygon');
});

test('รันซ้ำด้วยข้อมูลเดิม: ไม่มีการเปลี่ยนแปลง และไม่เขียนฐานข้อมูล', async () => {
  const db = await freshDb();
  const data = kml(pt('A', 99.30, 9.10) + pt('B', 99.31, 9.11), zone('ชุมชน 1'));
  await runSync(data);
  const before = await db.q('SELECT uid, updated_at FROM waste_points ORDER BY uid');
  await new Promise((r) => setTimeout(r, 20));
  const r = await runSync(data);
  assert.equal(r.changed, false);
  const after = await db.q('SELECT uid, updated_at FROM waste_points ORDER BY uid');
  assert.deepEqual(after, before); // updated_at ไม่ขยับ = ไม่ได้เขียนทับ
  const log = await db.q('SELECT ok, changed FROM sync_log ORDER BY id');
  assert.deepEqual(log.map((x) => [x.ok, x.changed]), [[true, true], [true, false]]);
});

test('แผนที่เปลี่ยน: เพิ่ม / แก้ / ลบ จุด และแก้ขอบเขตชุมชน', async () => {
  const db = await freshDb();
  await runSync(kml(
    pt('A', 99.30, 9.10, 'เดิม') + pt('B', 99.31, 9.11) + pt('C', 99.32, 9.12),
    zone('ชุมชน 1') + zone('ชุมชน 2', 99.35),
  ));
  const r = await runSync(kml(
    pt('A', 99.30, 9.10, 'แก้คำอธิบายแล้ว') + pt('C', 99.32, 9.12) + pt('D', 99.33, 9.13), // แก้ A, ลบ B, เพิ่ม D
    zone('ชุมชน 1', 99.30, 9.10, 0.02) + zone('ชุมชน 3', 99.40),                          // แก้ชุมชน 1, ลบชุมชน 2, เพิ่มชุมชน 3
  ));
  assert.equal(r.changed, true);
  assert.deepEqual([r.points.added, r.points.changed, r.points.removed], [1, 1, 1]);
  assert.deepEqual([r.zones.added, r.zones.changed, r.zones.removed], [1, 1, 1]);
  assert.deepEqual(await db.names('waste_points'), ['A', 'C', 'D']);
  assert.deepEqual(await db.names('waste_zones'), ['ชุมชน 1', 'ชุมชน 3']);
  const a = (await db.q("SELECT description FROM waste_points WHERE name = 'A'"))[0];
  assert.equal(a.description, 'แก้คำอธิบายแล้ว');
});

test('KML ไม่มีข้อมูลเลย: ล้มเหลว และข้อมูลเดิมอยู่ครบ', async () => {
  const db = await freshDb();
  await runSync(kml(pt('A', 99.30, 9.10), zone('ชุมชน 1')));
  await assert.rejects(() => runSync(kml()), /ไม่พบจุดหรือเขตชุมชน/);
  assert.equal(await db.count('waste_points'), 1);
  assert.equal(await db.count('waste_zones'), 1);
  const log = await db.q('SELECT ok FROM sync_log ORDER BY id');
  assert.deepEqual(log.map((x) => x.ok), [true, false]);
});

test('กันข้อมูลหดผิดปกติ: หดเกินครึ่งไม่อัปเดตทับ เว้นแต่ยืนยัน', async () => {
  const db = await freshDb();
  const many = Array.from({ length: 30 }, (_, i) => pt(`P${i}`, 99.3 + i / 1000, 9.1)).join('');
  await runSync(kml(many, zone('ชุมชน 1')));
  assert.equal(await db.count('waste_points'), 30);

  const few = Array.from({ length: 5 }, (_, i) => pt(`P${i}`, 99.3 + i / 1000, 9.1)).join('');
  await assert.rejects(() => runSync(kml(few, zone('ชุมชน 1'))), /หดผิดปกติ/);
  assert.equal(await db.count('waste_points'), 30); // ยังอยู่ครบ (rollback แล้ว)

  const r = await runSync(kml(few, zone('ชุมชน 1')), { allowShrink: true });
  assert.equal(r.points.removed, 25);
  assert.equal(await db.count('waste_points'), 5);
});

test('ชั้นข้อมูลชุมชนหายทั้งหมดโดยจุดยังอยู่: ถูกกันไว้ ไม่ลบชุมชนทิ้ง', async () => {
  const db = await freshDb();
  const zones = Array.from({ length: 12 }, (_, i) => zone(`ช${i}`, 99.3 + i / 100)).join('');
  await runSync(kml(pt('A', 99.30, 9.10), zones));
  await assert.rejects(() => runSync(kml(pt('A', 99.30, 9.10), '')), /หดผิดปกติ/);
  assert.equal(await db.count('waste_zones'), 12);
});

test('force: อัปเดตแม้ข้อมูลไม่เปลี่ยน', async () => {
  await freshDb();
  const data = kml(pt('A', 99.30, 9.10), zone('ชุมชน 1'));
  await runSync(data);
  const r = await runSync(data, { force: true });
  assert.equal(r.changed, true);
  assert.deepEqual([r.points.added, r.points.changed, r.points.removed], [0, 0, 0]);
});

test('ถ้าตารางถูกล้างแต่ hash เดิมยังอยู่: ตรวจพบและเติมข้อมูลกลับ', async () => {
  const db = await freshDb();
  const data = kml(pt('A', 99.30, 9.10), zone('ชุมชน 1'));
  await runSync(data);
  await db.q('DELETE FROM waste_points');
  const r = await runSync(data);
  assert.equal(r.changed, true);
  assert.equal(await db.count('waste_points'), 1);
});
