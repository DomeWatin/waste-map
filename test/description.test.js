import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { parseDescription, kmlToPoints } from '../lib/kml.js';
import { setPool, getPool } from '../lib/db.js';
import { ensureSchema, runSync } from '../lib/sync.js';

test('แยกรูปและข้อความ; รับเฉพาะรูป https ของ Google', () => {
  const html =
    '<img src="https://lh3.googleusercontent.com/umsh/AAA" height="200" width="auto"><br><br>' +
    'ละติจูด, ลองติจูด : 9.148, 99.326<br><br>' +
    '<img src="https://mymaps.usercontent.google.com/hostedimage/x?a=1&amp;b=2">' +
    '<img src="https://evil.example.com/p.png"><img src="http://lh3.googleusercontent.com/insecure">' +
    '<img src="https://lh3.googleusercontent.com/umsh/AAA">' +
    '<script>alert(1)</script> &lt;ok&gt; &amp;';
  const { text, images } = parseDescription(html);
  assert.deepEqual(images, [
    'https://lh3.googleusercontent.com/umsh/AAA',
    'https://mymaps.usercontent.google.com/hostedimage/x?a=1&b=2',
  ]);
  assert.match(text, /ละติจูด, ลองติจูด : 9\.148, 99\.326/);
  assert.ok(!text.includes('<img'));
  assert.ok(text.includes('<ok> &'));
});

test('KML: รูปแยกเป็น images, description เป็นข้อความล้วน', () => {
  const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>L</name>
    <Placemark><name>P</name><description><![CDATA[<img src="https://lh3.googleusercontent.com/umsh/Z"><br>ข้อความ]]></description>
    <Point><coordinates>99.3,9.1,0</coordinates></Point></Placemark></Folder></Document></kml>`;
  const [p] = kmlToPoints(kml);
  assert.deepEqual(p.images, ['https://lh3.googleusercontent.com/umsh/Z']);
  assert.equal(p.props.images, undefined);
  assert.equal(p.description, 'ข้อความ');
});

test('sync: จุดที่ uid ซ้ำในไฟล์เดียวกันไม่ทำให้พัง และได้ 1 แถว', async () => {
  const { Pool } = newDb().adapters.createPg();
  setPool(new Pool());
  await ensureSchema();
  const pm = `<Placemark><name>ซ้ำ</name><Point><coordinates>99.3,9.1,0</coordinates></Point></Placemark>`;
  const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>L</name>${pm}${pm}</Folder></Document></kml>`;
  const r = await runSync(kml);
  assert.equal(r.points.total, 1);
  assert.equal((await getPool().query('SELECT count(*)::int n FROM waste_points')).rows[0].n, 1);
});
