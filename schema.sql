-- จุดบริการเก็บถังขยะ (ข้อมูลจาก Google My Maps ของเทศบาล)
CREATE TABLE IF NOT EXISTS waste_points (
  uid         TEXT PRIMARY KEY,           -- layer|name|lng,lat
  layer       TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  lng         DOUBLE PRECISION NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  props       JSONB NOT NULL DEFAULT '{}'::jsonb,
  images      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- URL รูปถ่าย (โหลดแยกตอนกดดูจุด)
  photo_count INTEGER NOT NULL DEFAULT 0,
  row_hash    TEXT NOT NULL DEFAULT '',              -- ใช้ตรวจว่าแถวนี้เปลี่ยนจากแผนที่หรือไม่
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waste_points_layer_idx ON waste_points (layer);

-- เขตชุมชน (พื้นที่ Polygon / MultiPolygon เก็บเป็น GeoJSON geometry)
CREATE TABLE IF NOT EXISTS waste_zones (
  uid         TEXT PRIMARY KEY,           -- district|name
  district    TEXT NOT NULL DEFAULT '',   -- ชื่อโฟลเดอร์ เช่น เขตพัฒนาชุมชนที่ 1
  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  geom        JSONB NOT NULL,
  row_hash    TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- สถานะระบบ: เก็บ hash ของข้อมูลทั้งชุดรอบล่าสุด + ใช้เป็นตัวล็อกกันรันซ้อน
CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sync_state (key, value) VALUES ('snapshot_hash', '') ON CONFLICT (key) DO NOTHING;

-- ประวัติการตรวจ/ดึงข้อมูลแต่ละรอบ
CREATE TABLE IF NOT EXISTS sync_log (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok          BOOLEAN NOT NULL DEFAULT false,
  changed     BOOLEAN NOT NULL DEFAULT false,   -- true = แผนที่เปลี่ยนและมีการอัปเดตฐานข้อมูล
  point_count INTEGER,
  zone_count  INTEGER,
  message     TEXT
);
