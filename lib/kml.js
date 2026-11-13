import { DOMParser } from '@xmldom/xmldom';
import { kmlWithFolders } from '@tmcw/togeojson';

// ฟิลด์สไตล์ของ KML ที่ไม่ต้องเก็บใน props
const SKIP = new Set([
  'name', 'description', 'folder', 'styleUrl', 'styleHash',
  'stroke', 'stroke-opacity', 'stroke-width', 'fill', 'fill-opacity',
  'icon', 'icon-offset', 'icon-offset-units', 'marker-color', 'marker-symbol',
  'visibility', 'open', 'drawOrder', 'gx_media_links', 'label-scale', 'icon-scale',
]);

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/**
 * คำอธิบายใน My Maps เป็น HTML (รูปถ่าย + ข้อความ) -> แยกเป็นข้อความล้วน + รายการ URL รูป
 * รับเฉพาะรูป https จากโดเมนของ Google (googleusercontent.com, usercontent.google.com)
 */
export function parseDescription(html) {
  const raw = String(html ?? '');
  const images = [];
  for (const m of raw.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'));
      const h = u.hostname;
      const ok = h.endsWith('googleusercontent.com') || h.endsWith('usercontent.google.com');
      if (u.protocol === 'https:' && ok && !images.includes(u.toString())) images.push(u.toString());
    } catch { /* ข้าม URL ที่ไม่ถูกต้อง */ }
  }
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e])
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  return { text, images };
}

/** description ใน KML อาจเป็นข้อความ หรือออบเจ็กต์ { '@type': 'html', value } */
function asText(v) {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.value ?? '').trim();
  return String(v).trim();
}

// ---- เขตชุมชน (พื้นที่) ----

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** ดึงเฉพาะพื้นที่ (Polygon) ออกจากรูปทรงใดก็ได้ — เส้นและจุดที่ปนมาใน GeometryCollection จะถูกตัดทิ้ง */
function polygonsOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return (g.geometries ?? []).flatMap(polygonsOf);
  return [];
}

/** ตัดความสูง (altitude) ปัดทศนิยม 6 ตำแหน่ง และทิ้งวงแหวนที่ไม่ถูกต้อง (ต้องมี >= 4 จุด) */
function cleanPolygon(poly) {
  const rings = [];
  for (const ring of poly) {
    const pts = ring
      .map(([x, y]) => [round6(x), round6(y)])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (pts.length >= 4) rings.push(pts);
  }
  return rings.length ? rings : null; // วงแรกคือขอบนอก ที่เหลือคือรู
}

/**
 * แปลง KML (จาก Google My Maps) เป็น { points, zones }
 * - points: Placemark ที่เป็น Point  | zones: Placemark ที่มีพื้นที่ (Polygon) อย่างน้อย 1 รูป
 * - เส้นล้วน (LineString) ถูกข้าม
 * - layer / district = ชื่อ Folder (ถ้าซ้อนกันจะต่อด้วย " / ")
 * - พิกัดเป็น lng, lat ตามมาตรฐาน GeoJSON
 */
export function kmlToFeatures(kmlText) {
  const doc = new DOMParser().parseFromString(kmlText, 'text/xml');
  const tree = kmlWithFolders(doc);
  const points = [];
  const zones = [];
  const zoneUids = new Map();

  const walk = (node, path) => {
    if (!node) return;
    if (node.type === 'Feature') {
      const g = node.geometry;
      if (!g) return;
      const p = node.properties ?? {};
      const name = asText(p.name);
      const folder = path.join(' / ');

      if (g.type === 'Point') {
        const [lng, lat] = g.coordinates;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        const extra = {};
        for (const [k, v] of Object.entries(p)) {
          if (SKIP.has(k) || v === '' || v == null) continue;
          extra[k] = typeof v === 'object' ? asText(v) : v;
        }
        const { text, images } = parseDescription(asText(p.description));
        points.push({
          uid: `${folder}|${name}|${lng.toFixed(6)},${lat.toFixed(6)}`,
          layer: folder,
          name,
          description: text,
          images,
          lng,
          lat,
          props: extra,
        });
        return;
      }

      const polys = polygonsOf(g).map(cleanPolygon).filter(Boolean);
      if (polys.length) {
        // ชื่อซ้ำในโฟลเดอร์เดียวกัน: เติม #2, #3 เพื่อไม่ให้ชุมชนหนึ่งทับอีกชุมชนหนึ่ง
        const base = `${folder}|${name}`;
        const n = (zoneUids.get(base) ?? 0) + 1;
        zoneUids.set(base, n);
        zones.push({
          uid: n === 1 ? base : `${base}#${n}`,
          district: folder,
          name,
          description: parseDescription(asText(p.description)).text,
          geom: polys.length === 1
            ? { type: 'Polygon', coordinates: polys[0] }
            : { type: 'MultiPolygon', coordinates: polys },
        });
      }
      return;
    }
    const next = node.type === 'folder' && node.meta?.name ? [...path, String(node.meta.name).trim()] : path;
    for (const child of node.children ?? []) walk(child, next);
  };

  walk(tree, []);
  return { points, zones };
}

/** เฉพาะจุด (คงไว้เพื่อความเข้ากันได้กับโค้ดและการทดสอบเดิม) */
export function kmlToPoints(kmlText) {
  return kmlToFeatures(kmlText).points;
}

/**
 * ไฟล์ KML จากปุ่ม Export ของ My Maps อาจเป็นแค่ตัวห่อ <NetworkLink> ที่ชี้ไปยังข้อมูลจริง
 * คืนค่า URL ปลายทาง ถ้าไฟล์นี้เป็นตัวห่อ (และไม่มี Placemark) ไม่เช่นนั้นคืน null
 * ยอมรับเฉพาะ https://*.google.com เพื่อกันการถูกชี้ไปเว็บอื่น
 */
export function networkLinkHref(kmlText) {
  const doc = new DOMParser().parseFromString(kmlText, 'text/xml');
  if (doc.getElementsByTagName('Placemark').length > 0) return null;
  const hrefs = doc.getElementsByTagName('href');
  if (hrefs.length === 0) return null;
  const raw = (hrefs.item(0).textContent || '').trim();
  try {
    const u = new URL(raw);
    const okHost = u.hostname === 'google.com' || u.hostname.endsWith('.google.com');
    return u.protocol === 'https:' && okHost ? u.toString() : null;
  } catch {
    return null;
  }
}

/** แปลงแถวจุดจากฐานข้อมูลเป็น GeoJSON FeatureCollection */
export function rowsToGeoJSON(rows) {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        ...(r.props ?? {}),
        id: r.uid,
        name: r.name,
        layer: r.layer,
        description: r.description,
        photoCount: r.photo_count ?? 0,
      },
    })),
  };
}

/** แปลงแถวเขตชุมชนจากฐานข้อมูลเป็น GeoJSON FeatureCollection */
export function zonesToGeoJSON(rows) {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: r.geom,
      properties: { id: r.uid, name: r.name, district: r.district, description: r.description },
    })),
  };
}
