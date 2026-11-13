# คู่มือติดตั้ง "ถังขยะใกล้ฉัน" สำหรับผู้ไม่เคยทำมาก่อน

ภาพรวม: โค้ดอยู่บน **GitHub** → **Render** รันเว็บ → **Neon** เก็บฐานข้อมูล PostgreSQL → เปิดผ่าน **LINE OA** ด้วย **LIFF**
ข้อมูลจากแผนที่ Google ถูกตรวจและอัปเดตเข้า Neon ทุก 3 ชม. โดย **GitHub Actions** (ไม่เกี่ยวกับ Render)

```
Google My Maps ──(ทุก 3 ชม. GitHub Actions)──► Neon (ฐานข้อมูล) ◄── Render (เว็บ) ◄── LINE OA / LIFF ◄── ผู้ใช้
```

**Render หลับตามปกติ:** แพ็กเกจฟรีจะหลับเมื่อไม่มีคนเข้า 15 นาที คนแรกที่เข้าหลังจากนั้นรอประมาณ 1 นาทีให้เว็บตื่น
ข้อมูลยังอัปเดตทุก 3 ชม. ตามปกติเพราะ GitHub Actions คุยกับ Neon โดยตรง ไม่ต้องปลุก Render

> **สถานะการตรวจสอบ:** ชื่อปุ่ม/ขั้นตอนที่ทำเครื่องหมาย ✅ ตรวจกับเอกสารทางการแล้ว ส่วน ⚠️ คือจำจากประสบการณ์/ยังตรวจไม่ได้
> หน้าเว็บของบริการเหล่านี้เปลี่ยนบ่อย ถ้าชื่อปุ่มไม่ตรง ให้ดูปุ่มที่ใกล้เคียงที่สุด
> โค้ดนี้ทดสอบอัตโนมัติ 22 ข้อกับข้อมูลจำลองและไฟล์ KMZ จริงแล้ว แต่ **ยังไม่เคยรันกับ Neon/Render/LINE ตัวจริง** ขั้นตอนที่ 7 จึงสำคัญ

## สิ่งที่ต้องเตรียม
- อีเมล 1 อัน และบัญชี LINE (ที่เป็นแอดมินของ LINE OA)
- คอมพิวเตอร์ (แนะนำ) ติดตั้ง **Git** และ **Node.js 20+** (ไม่จำเป็นถ้าอัปโหลดไฟล์ผ่านเว็บ GitHub — ดูขั้นตอนที่ 2 ทางเลือก ข)

## ความลับที่ห้ามหลุด
- สตริงเชื่อมต่อ Neon (`postgresql://...รหัสผ่าน...`) **ห้ามส่งในแชท ห้ามใส่ในโค้ด ห้ามขึ้น GitHub**
  ใส่ได้เฉพาะ: Render (Environment Variables) และ GitHub (Secrets)
- ไฟล์ `.env` ถูกกันไว้ใน `.gitignore` แล้ว อย่าลบบรรทัดนั้น

---

## ขั้นตอนที่ 1 — สมัคร Neon และสร้างฐานข้อมูล
1. เข้า <https://neon.com> สมัครด้วย Google/GitHub/อีเมล
2. สร้าง Project: ตั้งชื่อเช่น `waste-map` เลือก Region **Singapore (AWS ap-southeast-1)** (ใกล้ไทยที่สุด) ⚠️ ชื่อตัวเลือกใน Region อาจต่างเล็กน้อย
3. คลิก **Connect** ที่แถบเมนูของ Console → จะเปิดหน้าต่าง **Connect to your branch** ✅ แล้วเลือก branch / database / role ตามค่าเริ่มต้น
4. ต้องใช้ตัวเลือกแบบ **pooled** — สังเกตที่ชื่อ host ต้องมี `-pooler` เช่น `ep-xxxx-pooler.ap-southeast-1.aws.neon.tech` ✅ (เอกสาร Neon แนะนำ pooled สำหรับแอปที่รันจริง)
   ถ้ายังเป็นแบบไม่มี `-pooler` ให้ลองมองหาสวิตช์ **Connection pooling** ในหน้าต่างนั้น ⚠️ (ไม่ได้ยืนยันชื่อสวิตช์จากเอกสาร)
5. กดคัดลอกสตริง เก็บไว้ในที่ปลอดภัย (เช่น โน้ตในเครื่อง) จะใช้ในขั้นที่ 3 และ 4
   - รูปแบบ: `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require&channel_binding=require` ✅
   - **ไม่ต้องสร้างตารางเอง** เว็บจะสร้างตารางให้อัตโนมัติตอนเริ่มทำงานครั้งแรก
   - ถ้าเคยสร้างตารางเวอร์ชันเก่าไว้ใน Neon: เปิดเมนู SQL Editor ⚠️ แล้วรัน `DROP TABLE IF EXISTS waste_points, waste_zones, sync_state, sync_log;` ก่อน

## ขั้นตอนที่ 2 — นำโค้ดขึ้น GitHub
1. สมัคร/เข้าสู่ระบบ <https://github.com> แล้วสร้าง repository ใหม่ (ปุ่ม **New**) ตั้งชื่อ `waste-map`
   - เลือก **Public** ถ้าต้องการให้ GitHub Actions ฟรีไม่จำกัด ⚠️ (repo ส่วนตัวมีโควตาเวลา Actions จำกัด)
   - โค้ดนี้ **ไม่มีรหัสผ่านอยู่ในไฟล์** จึงเป็น Public ได้ แต่ MID ของแผนที่จะมองเห็นได้ (แผนที่เป็นสาธารณะอยู่แล้ว)
2. แตก `waste-map.zip` เป็นโฟลเดอร์ แล้วเลือกวิธีใดวิธีหนึ่ง:

**ทางเลือก ก — ใช้ Git (แนะนำ ได้โฟลเดอร์ `.github` ครบ)**
```bash
cd waste-map
git init
git add .
git status          # ตรวจว่าไม่มี .env และไม่มีโฟลเดอร์ node_modules อยู่ในรายการ
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/<ชื่อผู้ใช้>/waste-map.git
git push -u origin main
```
GitHub จะให้ลงชื่อเข้าใช้ตอน push (ใช้ Personal Access Token แทนรหัสผ่านถ้าถูกถาม) ⚠️

**ทางเลือก ข — อัปโหลดผ่านเว็บ GitHub** (ปุ่ม **Add file → Upload files**) ⚠️ ไม่ได้ยืนยันข้อจำกัดจำนวนไฟล์จากเอกสาร
- โฟลเดอร์ `.github` ขึ้นต้นด้วยจุด บางระบบซ่อนไว้ ต้องเปิดการแสดงไฟล์ซ่อนก่อนจึงจะลากไปได้
- หลังอัปโหลด ต้องเห็นไฟล์ `.github/workflows/sync.yml` ใน repo ไม่เช่นนั้นการอัปเดตทุก 3 ชม. จะไม่ทำงาน

## ขั้นตอนที่ 3 — สร้างเว็บบน Render
1. สมัคร/เข้า <https://dashboard.render.com> (ใช้ "Sign in with GitHub" สะดวกที่สุด)
2. คลิก **New → Web Service** ✅ เลือกแหล่งโค้ดเป็น **Git Provider** ✅ แล้วเชื่อมบัญชี GitHub
   - หน้า "Install Render" ของ GitHub: แนะนำเลือก **Only select repositories** แล้วติ๊กเฉพาะ `waste-map`
3. เลือก repo `waste-map` แล้วกรอกฟอร์ม ✅:
   | ช่อง | ค่า |
   |---|---|
   | Name | `waste-map` (ชื่อนี้เป็นส่วนของ URL `https://<ชื่อ>.onrender.com`) |
   | Branch | `main` |
   | Language | `Node` |
   | Build Command | `npm install` |
   | Start Command | `node server.js` |
   | Plan (compute plan) | **Free** |
   | Region | เลือก **Singapore** ถ้ามี (ใกล้ Neon ที่เลือกไว้) ⚠️ |
4. เปิดส่วน **Advanced** ✅ เพื่อ:
   - เพิ่ม **Environment Variables**:
     | ชื่อ | ค่า |
     |---|---|
     | `DATABASE_URL` | สตริง Neon ที่คัดลอกไว้ (ต้องมี `-pooler`) |
     | `SYNC_TOKEN` | สตริงสุ่มยาว ๆ ที่คุณตั้งเอง เช่น 32 ตัวอักษรขึ้นไป (ใช้สั่งอัปเดตด้วยมือ) |
     | `MYMAPS_MID` | `1WyMxRL6t_FJZXkIRAyQ_UGg-xPfYz6w` |
     | `LIFF_ID` | เว้นไว้ก่อน ใส่ในขั้นที่ 6 |
   - **Health Check Path** = `/healthz` ✅
5. กด **Create Web Service** แล้วดูความคืบหน้าที่หน้า **Deploys** ✅ รอจนสถานะเป็น Live
6. เปิดลิงก์ `https://<ชื่อ>.onrender.com` ควรเห็นหน้าแผนที่ — แต่จะยังไม่มีจุด เพราะยังไม่ได้ดึงข้อมูล (ทำในขั้นที่ 4)

> ทางลัด: แทนข้อ 2–4 ใช้ **New → Blueprint** แล้วเลือก repo ก็ได้ Render จะอ่านไฟล์ `render.yaml` และถามค่า `DATABASE_URL`, `SYNC_TOKEN`, `LIFF_ID` ⚠️ (ไม่ได้ทดสอบเส้นทางนี้ในระบบจริง)

ข้อควรรู้เรื่องแพ็กเกจฟรี ✅: หลับเมื่อไม่มีคนเข้า 15 นาที, ปลุกใช้เวลาประมาณ 1 นาที, โควตา 750 ชม./เดือน/workspace (ตอนหลับไม่นับชั่วโมง), เอกสาร Render ระบุว่าไม่แนะนำใช้งานจริงระดับ production

## ขั้นตอนที่ 4 — ตั้งให้ GitHub ดึงข้อมูลทุก 3 ชม.
1. เปิด repo บน GitHub → **Settings** → **Secrets and variables** → **Actions** → แท็บ **Secrets** → **New repository secret** ✅
2. Name: `DATABASE_URL` (พิมพ์ตรงตามนี้) / Secret: วางสตริง Neon → **Add secret** ✅
3. ไปแท็บ **Actions** → เลือก workflow **sync-waste-map** → **Run workflow** เพื่อรันครั้งแรกด้วยมือ
   - ถ้าแท็บ Actions ขอให้กดเปิดใช้งาน workflow ให้กดอนุญาต ⚠️
4. รอประมาณ 1 นาที ต้องเห็นเครื่องหมายถูกสีเขียว คลิกเข้าไปดู log ควรเห็นข้อความทำนอง `[sync] อัปเดตแล้ว | จุด: เพิ่ม ... ชุมชน: เพิ่ม ...`
   - ถ้าเป็นกากบาทแดง ดูหัวข้อ "แก้ปัญหา"

ข้อควรรู้ ✅/⚠️: เวลารันตามตาราง (UTC) ของ GitHub อาจเลื่อนช่วงคิวแน่น และ repo สาธารณะที่ไม่มีกิจกรรมเลย 60 วัน GitHub จะปิดตารางเวลาให้เอง (push โค้ดหรือกด Run workflow ใหม่เพื่อเปิดอีกครั้ง) — ข้อนี้มาจากความรู้ที่ผมมี ไม่ได้ตรวจซ้ำในรอบนี้

## ขั้นตอนที่ 5 — ตรวจว่าข้อมูลเข้าแล้ว
1. เปิด `https://<ชื่อ>.onrender.com/api/status` (ครั้งแรกอาจรอ ~1 นาทีเพราะเว็บหลับ) ควรเห็น `"points":709` และ `"zones":70` (ตัวเลขตามข้อมูลแผนที่ ณ 12 พ.ย. 2569 ถ้าเทศบาลแก้แผนที่ ตัวเลขจะเปลี่ยนตาม)
2. เปิดหน้าเว็บ รีเฟรช ต้องเห็นจุดและเขตชุมชน ลองกด "แชร์ตำแหน่งปัจจุบัน"
3. (ไม่บังคับ) ใน Neon เปิด SQL Editor ⚠️ รัน `SELECT count(*) FROM waste_points;`

## ขั้นตอนที่ 6 — เชื่อม LINE OA ด้วย LIFF
**6.1 สร้าง Provider และ Channel** (ที่ <https://developers.line.biz/console/>)
1. ล็อกอินด้วยบัญชี LINE → **Create a new provider** → ตั้งชื่อ → **Create** ✅
2. ในพรอวายเดอร์ สร้าง Channel ชนิด **LINE Login** ✅ (Messaging API ใช้เก็บ LIFF ไม่ได้ ✅)
3. กรอก Channel name (ห้ามมีคำว่า "LINE"), คำอธิบาย, ไอคอน และเลือก App type = **Web app** ✅
   - Channel ย้ายข้าม Provider ภายหลังไม่ได้ ✅ ถ้าจะผูกกับ LINE OA เดิม ให้ใช้ Provider เดียวกับ OA ⚠️ (เอกสารกล่าวถึงเรื่องผูกกับ Messaging API channel ต้องอยู่ Provider เดียวกัน)

**6.2 เพิ่ม LIFF app**
1. เปิด Channel นั้น → แท็บ **LIFF** → **Add** ✅
2. กรอก:
   | ช่อง | ค่า |
   |---|---|
   | LIFF app name | `ถังขยะใกล้ฉัน` (ห้ามมีคำว่า LINE) ✅ |
   | Size | `Full` (เลือกเอง ให้แผนที่เต็มจอ) |
   | Endpoint URL | `https://<ชื่อ>.onrender.com` — ต้องเป็น **https** และห้ามมี `#` ✅ |
   | Scopes | ไม่ต้องติ๊ก (โค้ดนี้ไม่ใช้โปรไฟล์ผู้ใช้) |
   | Add friend option | `Off` |
3. กด **Add** อีกครั้งเพื่อบันทึก ✅ จะได้ **LIFF ID** (หน้าตาแบบ `1234567890-AbcdEfgh`) และ **LIFF URL** `https://liff.line.me/<LIFF ID>` ✅ (เอกสารไม่ระบุว่าแสดงที่หน้าไหน ให้ดูในรายการ LIFF ของ Channel)
4. กลับไป Render → Service → **Environment** → เพิ่ม/แก้ `LIFF_ID` = LIFF ID แล้วบันทึก (Render จะ deploy ใหม่เอง)
   - LIFF ID ไม่ใช่ความลับ (อยู่ใน URL อยู่แล้ว)

หมายเหตุ ✅: เอกสาร LINE แนะนำว่าแอปใหม่ควรสร้างเป็น **LINE MINI App** เพราะ LIFF กำลังถูกรวมเข้าไป แต่โค้ดนี้ใช้ LIFF ตามที่ตกลงไว้ — ยังใช้ได้ตามเอกสารปัจจุบัน

**6.3 ใส่ปุ่มใน LINE OA**
1. เปิด LINE Official Account Manager ⚠️ → **Rich menus** (เมนูริชเมนู) → สร้างเมนูใหม่ ⚠️
2. ที่ปุ่มที่ต้องการ ตั้ง Action เป็น **Link** แล้ววาง `https://liff.line.me/<LIFF ID>`
   (หรือส่งลิงก์นี้ในข้อความตอบกลับอัตโนมัติ) ⚠️ ชื่อเมนูภาษาไทยอาจต่างจากนี้
3. สถานะ LIFF/Channel: ถ้าระบบมีสถานะ **Developing/Published** ให้ตั้งเป็น **Published** ก่อนเปิดให้คนทั่วไปใช้ ⚠️ (จำจากประสบการณ์ ไม่ได้ตรวจในเอกสารรอบนี้ — ระหว่างทดสอบ ลองเปิดด้วยบัญชีแอดมินก่อน)

## ขั้นตอนที่ 7 — ทดสอบบนมือถือ (ต้องทำ)
1. เปิดลิงก์ `https://liff.line.me/<LIFF ID>` ในแอป LINE (หรือกดปุ่ม Rich menu)
2. รอหน้าโหลด (ครั้งแรกอาจ ~1 นาที) → กด **แชร์ตำแหน่งปัจจุบัน**
3. ต้องอนุญาตตำแหน่ง **2 ชั้น**: (ก) ตั้งค่ามือถือ → แอป LINE → ตำแหน่ง = อนุญาต (ข) หน้าต่างถามสิทธิ์ตอนกดปุ่ม
   - iOS: มีรายงานว่าถ้ากด "ไม่อนุญาต" ซ้ำ 2 ครั้ง จะขอสิทธิ์ใหม่ไม่ได้ ต้องไปเปิดในตั้งค่าเครื่องเอง ⚠️ (จากบทความ zenn.dev ที่เคยอ่าน)
4. กดปุ่ม "นำทาง" ที่จุดใดจุดหนึ่ง ต้องเปิดแอป Google Maps/เบราว์เซอร์ภายนอก
5. ⚠️ สิ่งที่ **ยังไม่เคยทดสอบกับเครื่องจริง:** ตำแหน่ง GPS ใน LINE, รูปถ่ายจุดที่โหลดจาก Google (บางรูปอาจไม่ขึ้นถ้า Google ไม่ให้ฝัง), การดึง KML สดจาก Google — ถ้าพบปัญหาแจ้งกลับพร้อมภาพหน้าจอ

---

## แก้ปัญหา
| อาการ | สาเหตุที่น่าจะเป็น / วิธีแก้ |
|---|---|
| เปิดเว็บแล้วหมุนนานครั้งแรก | เว็บ Render หลับ รอ ~1 นาที เป็นเรื่องปกติของแพ็กเกจฟรี |
| หน้าเว็บขึ้นแต่ไม่มีจุด | ยังไม่ได้รัน Actions รอบแรก (ขั้นตอน 4) หรือรันล้มเหลว ดู log |
| Actions ล้มเหลว: `DATABASE_URL`/`ECONNREFUSED`/`password authentication` | Secret ตั้งชื่อผิด หรือวางสตริงไม่ครบ/มีช่องว่างเกิน ลบแล้วสร้างใหม่ |
| Actions ล้มเหลว: ดึง KML ไม่ได้ (HTTP 4xx/429) | ตรวจว่าแผนที่ยังตั้งเป็น "สาธารณะ" และลองรันซ้ำภายหลัง ลิงก์ KML ที่ Google ให้อาจเปลี่ยน ใช้ `MYMAPS_KML_URL` ระบุเองได้ |
| log บอก "ข้อมูลหดเกินครึ่ง ไม่อัปเดต" | ระบบกันไว้ ถ้าตั้งใจลบข้อมูลจริง ใส่ env `SYNC_ALLOW_SHRINK=1` ชั่วคราวในรอบนั้น |
| `/api/sync` ตอบ 401 | header `x-sync-token` ไม่ตรงกับ `SYNC_TOKEN` บน Render |
| ตำแหน่งใน LINE ใช้ไม่ได้ | ดูขั้นตอนที่ 7 ข้อ 3 และลองเปิดในเบราว์เซอร์ปกติของมือถือเทียบ |
| LIFF ขึ้น error ตอนเปิด | Endpoint URL ผิด/ไม่ใช่ https หรือ `LIFF_ID` บน Render ไม่ตรง |
| ข้อมูลบนเว็บเก่า มีป้ายเหลือง "อาจเก่า" | Actions ไม่ได้รันเกิน 7 ชม. เช่น GitHub ปิด schedule เพราะไม่มีกิจกรรม 60 วัน → กด Run workflow |

สั่งอัปเดตด้วยมือ (ไม่ผ่าน GitHub):
```bash
curl -X POST -H "x-sync-token: <SYNC_TOKEN>" https://<ชื่อ>.onrender.com/api/sync
```
(เติม `?force=1` เพื่อบังคับเขียนทับทั้งชุด)

## เอกสารทางการที่ใช้ตรวจ
- Render: <https://render.com/docs/free>, <https://render.com/docs/web-services>
- Neon: <https://neon.com/docs/connect/choose-connection>, <https://neon.com/docs/get-started-with-neon/connect-neon>
- LINE: <https://developers.line.biz/en/docs/liff/registering-liff-apps/>, <https://developers.line.biz/en/docs/liff/getting-started/>, <https://developers.line.biz/en/docs/liff/developing-liff-apps/>
- GitHub Secrets: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets>
