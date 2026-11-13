import test from 'node:test';
import assert from 'node:assert/strict';
import { kmlToPoints, networkLinkHref } from '../lib/kml.js';

// ตัวห่อที่ My Maps ส่งออกจริงของแผนที่นี้ (ไม่มี Placemark)
const WRAPPER = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>จุดบริการเก็บถังขยะทั่วไปในเขตเทศบาลนครสุราษฎร์ธานี</name>
    <description/>
    <NetworkLink>
      <name>จุดบริการเก็บถังขยะทั่วไปในเขตเทศบาลนครสุราษฎร์ธานี</name>
      <Link>
        <href><![CDATA[https://www.google.com/maps/d/u/0/kml?forcekml=1&mid=1WyMxRL6t_FJZXkIRAyQ_UGg-xPfYz6w]]></href>
      </Link>
    </NetworkLink>
  </Document>
</kml>`;

test('ตัวห่อ NetworkLink: ไม่มีจุด แต่ดึงลิงก์ปลายทางได้', () => {
  assert.equal(kmlToPoints(WRAPPER).length, 0);
  assert.equal(
    networkLinkHref(WRAPPER),
    'https://www.google.com/maps/d/u/0/kml?forcekml=1&mid=1WyMxRL6t_FJZXkIRAyQ_UGg-xPfYz6w',
  );
});

test('ไม่ตามลิงก์ไปโดเมนที่ไม่ใช่ google.com', () => {
  const evil = WRAPPER.replace('https://www.google.com/maps/d/u/0/kml', 'https://evil.example.com/x');
  assert.equal(networkLinkHref(evil), null);
});

test('KML ที่มี Placemark ไม่ถือเป็นตัวห่อ', () => {
  const real = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>a</name>
    <Point><coordinates>99.3,9.1,0</coordinates></Point></Placemark></Document></kml>`;
  assert.equal(networkLinkHref(real), null);
});
