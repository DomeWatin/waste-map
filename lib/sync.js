import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.js';
import { kmlToFeatures, networkLinkHref } from './kml.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** ลิงก์ส่งออก KML ของ Google My Maps (ตั้งค่าได้ด้วย MYMAPS_KML_URL) */
export function kmlUrl() {
  if (process.env.MYMAPS_KML_URL) return process.env.MYMAPS_KML_URL;
  const mid = process.env.MYMAPS_MID;
  if (!mid) throw new Error('ต้องตั้ง MYMAPS_MID หรือ MYMAPS_KML_URL');
  // รูปแบบเดียวกับที่ Google ใส่ในไฟล์ KML ที่ส่งออกจาก My Maps ของแผนที่นี้
  return `https://www.google.com/maps/d/u/0/kml?forcekml=1&mid=${encodeURIComponent(mid)}`;
}

export async function ensureSchema() {
  const sql = fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');
  await getPool().query(sql);
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'waste-map-sync/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ดึง KML ไม่สำเร็จ: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('<kml')) {
    throw new Error('ข้อมูลที่ได้ไม่ใช่ KML (แผนที่อาจไม่ได้ตั้งเป็นสาธารณะ)');
  }
  return text;
}

/** ดึง KML; ถ้าได้ตัวห่อ NetworkLink จะตามลิงก์ต่อให้ 1 ชั้น */
export async function fetchKml() {
  let text = await getText(kmlUrl());
  const next = networkLinkHref(text);
  if (next) text = await getText(next);
  return text;
}

// ---------------------------------------------------------------------------
// การตรวจการเปลี่ยนแปลง
//
// ไม่เทียบไฟล์ KML ดิบ เพราะอาจมีค่าที่เปลี่ยนทุกครั้งที่ส่งออก ทำให้เห็นว่า "เปลี่ยน" ตลอดโดยไม่มีเหตุ
// แต่เทียบ "ข้อมูลที่แปลงแล้ว" ทีละแถวด้วย hash (ชื่อ, คำอธิบาย, พิกัด, รูป ฯลฯ)
//   - hash รวมทั้งชุดตรงกับรอบก่อน และจำนวนแถวในฐานข้อมูลตรง -> ไม่เขียนอะไรเลย
//   - ต่างกัน -> เขียนเฉพาะแถวที่เพิ่ม/แก้ และลบแถวที่หายไปจากแผนที่
// ---------------------------------------------------------------------------

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

const POINTS = {
  table: 'waste_points',
  label: 'จุด',
  cols: ['uid', 'layer', 'name', 'description', 'lng', 'lat', 'props', 'images', 'photo_count', 'row_hash'],
  hash: (r) => sha(JSON.stringify([r.layer, r.name, r.description, r.lng, r.lat, r.images, r.props])),
  values: (r) => [r.uid, r.layer, r.name, r.description, r.lng, r.lat,
    JSON.stringify(r.props), JSON.stringify(r.images), r.images.length, r.hash],
};

const ZONES = {
  table: 'waste_zones',
  label: 'ชุมชน',
  cols: ['uid', 'district', 'name', 'description', 'geom', 'row_hash'],
  hash: (r) => sha(JSON.stringify([r.district, r.name, r.description, r.geom])),
  values: (r) => [r.uid, r.district, r.name, r.description, JSON.stringify(r.geom), r.hash],
};

/** ตัดแถวที่ uid ซ้ำ (Postgres ไม่ยอมให้แถวเดียวถูก upsert สองครั้งในคำสั่งเดียว) แล้วคำนวณ hash */
function prepare(spec, rows) {
  const unique = [...new Map(rows.map((r) => [r.uid, r])).values()];
  return unique.map((r) => ({ ...r, hash: spec.hash(r) }));
}

const snapshotHash = (points, zones) =>
  sha([
    ...points.map((r) => `P|${r.uid}|${r.hash}`),
    ...zones.map((r) => `Z|${r.uid}|${r.hash}`),
  ].sort().join('\n'));

const countRows = async (client, table) =>
  (await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

/** กันข้อมูลหายผิดพลาด: ถ้าหดเกินครึ่งจะไม่อัปเดตทับ (เช่น มีคนลบทั้งชั้นข้อมูลโดยไม่ตั้งใจ) */
function assertNoShrink(label, before, after, minRows) {
  if (before >= minRows && after < before * 0.5) {
    throw new Error(
      `ข้อมูล${label}หดผิดปกติ: ${before} -> ${after} (ต่ำกว่าครึ่ง) จึงไม่อัปเดตทับ ` +
      'ถ้าตั้งใจลบจริงให้ตั้ง SYNC_ALLOW_SHRINK=1 แล้วรันใหม่',
    );
  }
}

/** เขียนเฉพาะแถวที่เพิ่ม/เปลี่ยน และลบแถวที่หายไป (ทำใน transaction ของผู้เรียก) */
async function applyDiff(client, spec, rows) {
  const existing = new Map(
    (await client.query(`SELECT uid, row_hash FROM ${spec.table}`)).rows.map((r) => [r.uid, r.row_hash]),
  );
  const incoming = new Set(rows.map((r) => r.uid));
  const toWrite = rows.filter((r) => existing.get(r.uid) !== r.hash);
  const added = toWrite.filter((r) => !existing.has(r.uid)).length;
  const removedIds = [...existing.keys()].filter((id) => !incoming.has(id));

  const width = spec.cols.length;
  const setList = spec.cols.filter((c) => c !== 'uid').map((c) => `${c} = EXCLUDED.${c}`).join(', ');

  // ชุดละ 100 แถว — ไม่ยิงทีละแถวข้ามเครือข่ายไป Neon
  for (let i = 0; i < toWrite.length; i += 100) {
    const chunk = toWrite.slice(i, i + 100);
    const params = [];
    const tuples = chunk.map((r, j) => {
      params.push(...spec.values(r));
      const ph = spec.cols.map((_, k) => `$${j * width + k + 1}`).join(',');
      return `(${ph}, now())`;
    });
    await client.query(
      `INSERT INTO ${spec.table} (${spec.cols.join(', ')}, updated_at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (uid) DO UPDATE SET ${setList}, updated_at = now()`,
      params,
    );
  }
  for (let i = 0; i < removedIds.length; i += 200) {
    const ids = removedIds.slice(i, i + 200);
    await client.query(
      `DELETE FROM ${spec.table} WHERE uid IN (${ids.map((_, k) => `$${k + 1}`).join(',')})`,
      ids,
    );
  }
  return {
    total: rows.length,
    added,
    changed: toWrite.length - added,
    removed: removedIds.length,
  };
}

const fmt = (spec, d) => `${spec.label}: เพิ่ม ${d.added}, แก้ ${d.changed}, ลบ ${d.removed} (รวม ${d.total})`;

/**
 * ดึง KML -> ตรวจว่าเปลี่ยนจากรอบก่อนหรือไม่ -> อัปเดตฐานข้อมูลใน transaction เดียว
 * ถ้าดึงไม่สำเร็จ / ไม่มีข้อมูล / ข้อมูลหดผิดปกติ จะไม่แตะข้อมูลเดิม และบันทึกใน sync_log
 *
 * opts.force        อัปเดตแม้ไม่พบความเปลี่ยนแปลง (หรือ SYNC_FORCE=1)
 * opts.allowShrink  ยอมให้ข้อมูลหดเกินครึ่ง (หรือ SYNC_ALLOW_SHRINK=1)
 */
export async function runSync(kmlText, opts = {}) {
  const force = opts.force ?? process.env.SYNC_FORCE === '1';
  const allowShrink = opts.allowShrink ?? process.env.SYNC_ALLOW_SHRINK === '1';
  const pool = getPool();
  const logId = (await pool.query('INSERT INTO sync_log (started_at) VALUES (now()) RETURNING id')).rows[0].id;

  try {
    const text = kmlText ?? (await fetchKml());
    const parsed = kmlToFeatures(text);
    const points = prepare(POINTS, parsed.points);
    const zones = prepare(ZONES, parsed.zones);
    if (points.length === 0 && zones.length === 0) {
      throw new Error('ไม่พบจุดหรือเขตชุมชนใน KML — ไม่อัปเดตข้อมูลเดิม');
    }
    const snap = snapshotHash(points, zones);

    const client = await pool.connect();
    let result;
    let message;
    try {
      await client.query('BEGIN');
      // ล็อกแถวสถานะ: ถ้ามีอีกรอบ (เช่น cron กับการสั่งมือ) กำลังอัปเดตอยู่ จะรอจนเสร็จก่อน แล้วค่อยอ่าน hash ล่าสุด
      await client.query("UPDATE sync_state SET updated_at = now() WHERE key = 'snapshot_hash'");
      const prev = (await client.query("SELECT value FROM sync_state WHERE key = 'snapshot_hash'")).rows[0]?.value ?? '';
      const dbPoints = await countRows(client, 'waste_points');
      const dbZones = await countRows(client, 'waste_zones');

      if (!force && prev === snap && dbPoints === points.length && dbZones === zones.length) {
        await client.query('COMMIT');
        result = { ok: true, changed: false, points: { total: points.length }, zones: { total: zones.length } };
        message = `ตรวจแล้ว ไม่มีการเปลี่ยนแปลง (จุด ${points.length}, ชุมชน ${zones.length})`;
      } else {
        if (!allowShrink) {
          assertNoShrink('จุด', dbPoints, points.length, 20);
          assertNoShrink('ชุมชน', dbZones, zones.length, 10);
        }
        const dp = await applyDiff(client, POINTS, points);
        const dz = await applyDiff(client, ZONES, zones);
        await client.query("UPDATE sync_state SET value = $1, updated_at = now() WHERE key = 'snapshot_hash'", [snap]);
        await client.query('COMMIT');
        result = { ok: true, changed: true, points: dp, zones: dz };
        message = `${fmt(POINTS, dp)} | ${fmt(ZONES, dz)}`;
      }
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    await pool.query(
      `UPDATE sync_log SET finished_at = now(), ok = true, changed = $2, point_count = $3, zone_count = $4, message = $5
       WHERE id = $1`,
      [logId, result.changed, points.length, zones.length, message],
    );
    return result;
  } catch (e) {
    await pool.query(
      'UPDATE sync_log SET finished_at = now(), ok = false, message = $2 WHERE id = $1',
      [logId, String(e.message).slice(0, 500)],
    );
    throw e;
  }
}
