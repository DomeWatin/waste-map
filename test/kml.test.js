import test from 'node:test';
import assert from 'node:assert/strict';
import { kmlToPoints, rowsToGeoJSON } from '../lib/kml.js';

// ตัวอย่าง KML โครงสร้างเดียวกับที่ Google My Maps ส่งออก (ข้อมูลสมมติ ไม่ใช่ข้อมูลจริงของเทศบาล)
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>ทดสอบ</name>
  <Folder><name>ถังขยะทั่วไป</name>
    <Placemark><name>จุด ก</name><description><![CDATA[ถนนตัวอย่าง<br>ซอย 1]]></description>
      <Point><coordinates>99.3217,9.1388,0</coordinates></Point></Placemark>
    <Placemark><name>จุด ข</name>
      <Point><coordinates>99.3300,9.1400,0</coordinates></Point></Placemark>
  </Folder>
  <Folder><name>จุดพักขยะ</name>
    <Placemark><name>จุด ค</name>
      <Point><coordinates>99.3100,9.1300,0</coordinates></Point></Placemark>
    <Placemark><name>เส้นทาง</name>
      <LineString><coordinates>99.31,9.13,0 99.32,9.14,0</coordinates></LineString></Placemark>
  </Folder>
</Document></kml>`;

test('แปลง KML เป็นจุด และข้ามรูปทรงที่ไม่ใช่ Point', () => {
  const pts = kmlToPoints(SAMPLE);
  assert.equal(pts.length, 3);
  const a = pts.find((p) => p.name === 'จุด ก');
  assert.equal(a.layer, 'ถังขยะทั่วไป');
  assert.equal(a.lng, 99.3217);
  assert.equal(a.lat, 9.1388);
  assert.match(a.description, /ถนนตัวอย่าง/);
});

test('ชื่อ layer มาจาก Folder', () => {
  const layers = new Set(kmlToPoints(SAMPLE).map((p) => p.layer));
  assert.deepEqual([...layers].sort(), ['จุดพักขยะ', 'ถังขยะทั่วไป'].sort());
});

test('uid ไม่ซ้ำกันในจุดที่ต่างกัน', () => {
  const pts = kmlToPoints(SAMPLE);
  assert.equal(new Set(pts.map((p) => p.uid)).size, pts.length);
});

test('rowsToGeoJSON ได้ FeatureCollection พิกัดเรียง [lng, lat]', () => {
  const gj = rowsToGeoJSON(kmlToPoints(SAMPLE));
  assert.equal(gj.type, 'FeatureCollection');
  assert.equal(gj.features.length, 3);
  assert.deepEqual(gj.features[0].geometry.coordinates.length, 2);
  assert.ok(gj.features[0].geometry.coordinates[0] > 99); // lng
});

test('KML ว่างได้ 0 จุด (sync จะไม่ลบข้อมูลเดิม)', () => {
  const empty = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>';
  assert.equal(kmlToPoints(empty).length, 0);
});

// ---- เขตชุมชน ----
import { kmlToFeatures } from '../lib/kml.js';

const ring = (x, y, d = 0.01) => `${x},${y},5 ${x + d},${y},5 ${x + d},${y + d},5 ${x},${y},5`;
const poly = (x, y) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(x, y)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;

test('เขตชุมชน: Polygon เดียว -> Polygon, ตัดความสูง, ชื่อเขตมาจาก Folder', () => {
  const k = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>เขตพัฒนาชุมชนที่ 1</name>
    <Placemark><name>ชุมชน ก</name>${poly(99.3, 9.1)}</Placemark></Folder></Document></kml>`;
  const { points, zones } = kmlToFeatures(k);
  assert.equal(points.length, 0);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].district, 'เขตพัฒนาชุมชนที่ 1');
  assert.equal(zones[0].geom.type, 'Polygon');
  assert.equal(zones[0].geom.coordinates[0][0].length, 2); // ไม่มี altitude
});

test('เขตชุมชน: หลายพื้นที่ -> MultiPolygon, เส้นที่ปนมาถูกตัดทิ้ง', () => {
  const k = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>เขต</name>
    <Placemark><name>ชุมชน ข</name><MultiGeometry>${poly(99.3, 9.1)}${poly(99.4, 9.2)}
      <LineString><coordinates>99.3,9.1,0 99.31,9.11,0</coordinates></LineString></MultiGeometry></Placemark>
    </Folder></Document></kml>`;
  const { zones } = kmlToFeatures(k);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].geom.type, 'MultiPolygon');
  assert.equal(zones[0].geom.coordinates.length, 2);
});

test('เส้นล้วนไม่ใช่เขตชุมชน และชื่อซ้ำในโฟลเดอร์เดียวกันไม่ทับกัน', () => {
  const k = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>เขต</name>
    <Placemark><name>เส้นทาง</name><LineString><coordinates>99.3,9.1,0 99.31,9.11,0</coordinates></LineString></Placemark>
    <Placemark><name>ซ้ำ</name>${poly(99.3, 9.1)}</Placemark>
    <Placemark><name>ซ้ำ</name>${poly(99.5, 9.3)}</Placemark></Folder></Document></kml>`;
  const { zones } = kmlToFeatures(k);
  assert.equal(zones.length, 2);
  assert.equal(new Set(zones.map((z) => z.uid)).size, 2);
});
