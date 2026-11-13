// รันโดย GitHub Actions ทุก 3 ชั่วโมง (.github/workflows/sync.yml):  node sync.js
// ตรวจแผนที่ My Maps ก่อน ถ้าไม่เปลี่ยนจะไม่เขียนฐานข้อมูล ถ้าเปลี่ยนจะอัปเดตเฉพาะส่วนที่ต่าง
import { closePool } from './lib/db.js';
import { ensureSchema, runSync } from './lib/sync.js';

try {
  await ensureSchema();
  const r = await runSync();
  if (!r.changed) {
    console.log(`[sync] ตรวจแล้ว ไม่มีการเปลี่ยนแปลง (จุด ${r.points.total}, ชุมชน ${r.zones.total})`);
  } else {
    const f = (d) => `เพิ่ม ${d.added}, แก้ ${d.changed}, ลบ ${d.removed} (รวม ${d.total})`;
    console.log(`[sync] อัปเดตแล้ว | จุด: ${f(r.points)} | ชุมชน: ${f(r.zones)}`);
  }
} catch (e) {
  console.error('[sync] ล้มเหลว:', e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
