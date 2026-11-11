# ขั้นที่ 1–2: วิเคราะห์ระบบ สถาปัตยกรรม ผังการทำงาน และการออกแบบ UI/UX

ระบบลงเวลาปฏิบัติงานออนไลน์ โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่ (Wat Sao Hin School Attendance System)
— *ระบบลงเวลาอัจฉริยะ สะดวก โปร่งใส ตรวจสอบได้*

## 1. วิเคราะห์ระบบ

### 1.1 ผู้ใช้งานและบทบาท (Role)

| บทบาท | รหัสในระบบ | ใครควรได้รับ | ทำอะไรได้ |
|---|---|---|---|
| บุคลากร | `USER` | ครู บุคลากรทางการศึกษา เจ้าหน้าที่ | ลงเวลาเข้า/ออกด้วย GPS, ดูประวัติของตนเอง, ยื่นใบลา, ยื่นคำร้องแก้ไขเวลา, เปลี่ยนรหัสผ่าน |
| ผู้บริหาร | `EXECUTIVE` | ผู้อำนวยการ / รองผู้อำนวยการ | ทุกอย่างของบุคลากร + Dashboard ภาพรวม, รายงานทุกประเภท, ส่งออก Excel/PDF, อนุมัติการลาและคำร้องแก้ไขเวลา, ดูปฏิทิน |
| ผู้ดูแลระบบ | `ADMIN` | ครูผู้รับผิดชอบระบบ / ธุรการ | ทุกอย่างของผู้บริหาร + จัดการสมาชิก, อนุมัติการสมัคร, รีเซ็ตรหัสผ่าน, ตั้งค่า GPS/เวลา, ปฏิทินวันหยุด, Audit Log, งานบำรุงรักษา |

### 1.2 ตารางสิทธิ์ (ตรวจที่ Server ทุกคำสั่ง — ดู `getRoutes_()` ใน `src/Code.gs`)

| คำสั่ง (action) | USER | EXECUTIVE | ADMIN |
|---|:-:|:-:|:-:|
| `auth.*` (session, ping, logout, changePassword) | ✅ | ✅ | ✅ |
| `me.dashboard`, `me.history`, `att.preview`, `att.checkIn`, `att.checkOut` | ✅ | ✅ | ✅ |
| `leave.my/submit/cancel`, `corr.my/submit/cancel` | ✅ (ของตนเอง) | ✅ | ✅ |
| `file.get` (ไฟล์แนบ) | ✅ เฉพาะของตนเอง | ✅ | ✅ |
| `admin.view`, `admin.overview`, `emp.basicList` | ❌ | ✅ | ✅ |
| `leave.adminList/review`, `corr.adminList/review` | ❌ | ✅ (ยกเว้นของตนเอง) | ✅ (ยกเว้นของตนเอง) |
| `report.daily/monthly/yearly/individual/export`, `cal.list` | ❌ | ✅ | ✅ |
| `emp.list/create/update/setStatus/setRole/approve/reject/delete/resetPassword/unlock` | ❌ | ❌ | ✅ |
| `settings.get/save`, `cal.add/remove/addFixed`, `audit.list`, `sys.*` | ❌ | ❌ | ✅ |

การเรียกคำสั่งที่ไม่มีสิทธิ์จะได้รับ `FORBIDDEN` และถูกบันทึกใน Audit Log (`ACCESS_DENIED`) ทุกครั้ง

### 1.3 แนวคิดหลักของการออกแบบ

1. **ไม่มีค่าใช้จ่ายรายเดือน** — Google Apps Script (Web App) + Google Sheets + Google Drive + Chart.js (CDN ฟรี) + Google Fonts + ลิงก์แผนที่ธรรมดา (OpenStreetMap / Google Maps) ไม่ใช้ API ที่เสียเงิน ไม่ต้องเช่า Hosting/โดเมน
2. **Server เป็นผู้ตัดสินทุกอย่าง** — เวลา, ระยะทาง, สิทธิ์, สถานะ คำนวณที่ Server Browser ส่งมาเพียงพิกัด + ค่าความแม่นยำ
3. **ไม่ลบประวัติ** — การแก้ไขเวลาเพิ่มรายการใหม่และทำเครื่องหมายรายการเดิม, Audit Log เพิ่มต่อท้ายอย่างเดียว
4. **ประหยัดโควตา** — แคชข้อมูลที่อ่านบ่อย (บุคลากร/ตั้งค่า/ปฏิทิน) ใน CacheService, ค้นหาด้วย TextFinder แทนการอ่านทั้งชีต, หน้า Dashboard ใช้คำสั่งเดียวโหลดข้อมูลทั้งหมด, โหลด Chart.js และหน้า Admin เฉพาะเมื่อจำเป็น
5. **Mobile First** — ปุ่มลงเวลาใหญ่ อยู่ถัดจากนาฬิกาทันที, เมนูล่างแบบแอป, ตารางเปลี่ยนเป็นการ์ดบนจอเล็ก

## 2. สถาปัตยกรรมระบบ

```mermaid
flowchart LR
  subgraph Phone["โทรศัพท์ / คอมพิวเตอร์ (Browser)"]
    UI["Index.html<br/>Login / Register / Dashboard<br/>(+ AdminDashboard เมื่อมีสิทธิ์)"]
    GPS["Geolocation API<br/>(อ่านเฉพาะตอนกดปุ่ม)"]
  end
  subgraph GAS["Google Apps Script Web App (Execute as: เจ้าของระบบ)"]
    API["api(token, action, params)<br/>Code.gs — ตรวจ Session + Role"]
    AUTH["Auth.gs<br/>PBKDF2 + Salt + Pepper<br/>Session / Lockout"]
    ATT["Attendance.gs<br/>Haversine / LockService"]
    LV["Leave.gs<br/>ลา / คำร้อง / ไฟล์แนบ"]
    ADM["Admin.gs"]
    REP["Reports.gs<br/>คำนวณสถานะ / Export"]
    DB["Database.gs<br/>CRUD / Cache / SetupSystem"]
  end
  subgraph Google["บริการฟรีของ Google"]
    SH[("Google Sheets<br/>9 ชีต")]
    DR[("Google Drive<br/>เอกสารแนบ / ไฟล์ชั่วคราว")]
    CA[("CacheService<br/>Session / แคช")]
    PR[("Script Properties<br/>Pepper / IDs")]
  end
  UI -- google.script.run --> API
  GPS --> UI
  API --> AUTH & ATT & LV & ADM & REP
  AUTH & ATT & LV & ADM & REP --> DB
  DB --> SH
  LV --> DR
  REP --> DR
  AUTH --> CA
  AUTH --> PR
```

## 3. ผังการทำงาน

### 3.1 สมัครสมาชิก → อนุมัติ → เข้าสู่ระบบครั้งแรก

```mermaid
flowchart TD
  A([บุคลากรเปิด URL]) --> B[กด สมัครสมาชิก]
  B --> C[กรอก ชื่อ-นามสกุล / รหัสบุคลากร / ตำแหน่ง /<br/>Username / รหัสผ่าน / ยืนยันรหัสผ่าน + ยอมรับนโยบาย GPS]
  C --> D{Server ตรวจสอบ}
  D -- ข้อมูลไม่ถูกต้อง/รหัสผ่านไม่ผ่านเกณฑ์ --> C
  D -- Username หรือรหัสบุคลากรซ้ำ --> C
  D -- ผ่าน --> E[บันทึกสถานะ PENDING<br/>รหัสผ่านเก็บเป็น Hash]
  E --> F[แสดง สมัครสำเร็จ รออนุมัติ + เลขอ้างอิง]
  F --> G{Admin ตรวจสอบ}
  G -- อนุมัติ + เลือกบทบาท --> H[ACTIVE, ActiveFrom = วันนี้]
  G -- ไม่อนุมัติ + เหตุผล --> I[REJECTED]
  H --> J([เข้าสู่ระบบและลงเวลาได้])
```

### 3.1.1 ติดตั้งครั้งแรก (ชุดติดตั้งแบบง่าย)

```mermaid
flowchart TD
  A[เจ้าของบัญชีวาง 3 ไฟล์ + Deploy] --> B[เปิด URL ครั้งแรก]
  B --> C[getPublicConfig → setupCore_<br/>สร้างไฟล์ฐานข้อมูล 9 ชีต + กุญแจ + Trigger]
  C --> D[สร้างรหัสติดตั้งใช้ครั้งเดียว<br/>เก็บใน Script Properties + ชีต เริ่มต้นใช้งาน]
  D --> E[หน้าเว็บแสดงฟอร์ม เริ่มต้นใช้งานระบบ<br/>ไม่ส่งรหัสมาที่ Browser]
  E --> F[เจ้าของเปิด Google Sheet ของตนเอง คัดลอกรหัส]
  F --> G{firstRunSetup: รหัสถูกต้อง?<br/>ยังไม่มี Admin? ≤ 20 ครั้ง/ชม.}
  G -- ไม่ --> E
  G -- ใช่ --> H[สร้าง ADMIN + บันทึกพิกัด/เวลา<br/>ลบรหัสและชีตชั่วคราว + Audit Log]
  H --> I([เข้าสู่ระบบทันที])
```

### 3.2 เข้าสู่ระบบและ Session

```mermaid
sequenceDiagram
  participant U as Browser
  participant S as Server (Auth.gs)
  participant C as CacheService
  participant D as Sheets
  U->>S: login(username, password)
  S->>C: ตรวจการล็อกชั่วคราว (ผิดเกิน 5 ครั้ง)
  S->>D: ค้นหา Username (TextFinder)
  S->>S: PBKDF2(HMAC(pepper, password), salt) เปรียบเทียบแบบ constant-time
  alt ไม่ถูกต้อง
    S->>C: นับครั้งที่ผิด → ล็อก 15 นาทีเมื่อครบ
    S-->>U: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (เหลือ n ครั้ง)"
  else ถูกต้องแต่ PENDING / REJECTED / INACTIVE
    S-->>U: แจ้งสถานะบัญชี
  else สำเร็จ
    S->>C: เก็บ SHA-256(token) → {uid, sessionVersion} TTL 30 นาที (ต่ออายุเมื่อใช้งาน)
    S-->>U: token (256 บิต) + ข้อมูลผู้ใช้ (+ บังคับเปลี่ยนรหัสผ่านถ้าจำเป็น)
  end
  U->>S: api(token, action) ทุกคำสั่ง
  S->>C: ตรวจ token / หมดอายุ / ≤ 12 ชม.
  S->>D: ตรวจสถานะบัญชี + Role + SessionVersion ล่าสุด (ผ่านแคชแบบมีเวอร์ชัน)
```

### 3.3 ลงเวลาเข้า/ออกงานด้วย GPS (ฟังก์ชันหลัก)

```mermaid
sequenceDiagram
  participant T as ครู (Browser)
  participant G as GPS โทรศัพท์
  participant S as Server (Attendance.gs)
  participant L as LockService
  participant D as Sheets
  T->>T: กด "ลงเวลาเข้างาน" (ปุ่มถูกปิดระหว่างทำงาน กันกดซ้ำ)
  T->>G: 1) ขออนุญาตตำแหน่ง
  G-->>T: 2) Latitude, Longitude 3) Accuracy (รอค่าที่แม่นยำขึ้นไม่เกิน ~15 วินาที แล้วหยุดอ่านทันที)
  T->>S: 4) api('att.checkIn', {lat, lng, accuracy})
  S->>S: ตรวจรูปแบบพิกัด, 5) Haversine ระยะห่างจากโรงเรียน, 6) Accuracy ≤ เกณฑ์?
  alt อยู่นอกรัศมี / Accuracy ไม่ผ่าน
    S->>D: Audit Log (เก็บเฉพาะระยะทาง/ความแม่นยำ)
    S-->>T: 8) ข้อความแจ้งเตือน + ระยะห่าง (สีแดง)
  else ผ่าน
    S->>L: tryLock
    S->>S: เวลา = นาฬิกา Server (Asia/Bangkok)
    S->>D: ตรวจ DailySummary วันนี้ (เข้าแล้ว? / ยังไม่เข้าแต่จะออก?)
    S->>D: 7) เพิ่ม AttendanceLogs + ปรับ DailySummary (สาย/ออกก่อนเวลา ตามการตั้งค่า)
    S->>L: flush + releaseLock
    S-->>T: สำเร็จ: เวลา, สถานะ, ระยะห่าง (สีเขียว), ลิงก์แผนที่
  end
```

### 3.4 คำร้องแก้ไขเวลา (ไม่ลบประวัติ)

```mermaid
flowchart TD
  A[ครูยื่นคำร้อง: วันที่ / เข้า-ออก / เวลา / เหตุผล / หลักฐาน] --> B[PENDING]
  B --> C{ผู้บริหาร/Admin<br/>ที่ไม่ใช่ผู้ยื่น}
  C -- ไม่อนุมัติ + เหตุผล --> R[REJECTED]
  C -- อนุมัติ --> D{มีรายการเดิมของวันนั้น?}
  D -- มี --> E[รายการเดิม IsActive=FALSE<br/>SupersededBy=รายการใหม่]
  D -- ไม่มี --> F
  E --> F[เพิ่มรายการใหม่ Source=CORRECTION<br/>RefID=รหัสคำร้อง]
  F --> G[ปรับ DailySummary + คำนวณสาย/ออกก่อนเวลาใหม่]
  G --> H[Audit Log: ข้อมูลก่อน/หลัง + ผู้อนุมัติ]
```

### 3.5 การลา

ครูยื่นใบลา (ประเภท/วันที่/ครึ่งวันเช้า-บ่าย/เหตุผล/เอกสาร) → ระบบนับเฉพาะวันทำการตามปฏิทิน และป้องกันลาซ้อนช่วงเดิม → ผู้บริหาร/Admin (ที่ไม่ใช่ผู้ยื่น) อนุมัติ/ไม่อนุมัติ/ยกเลิกการอนุมัติ → ใบลาที่อนุมัติถูกนำไปคำนวณในรายงานทันที (วันที่ไม่มาแต่มีใบลา = “ลา” ไม่ใช่ “ขาดงาน”, ลาครึ่งเช้าไม่นับสาย, ลาครึ่งบ่ายไม่นับไม่ลงเวลาออก)

### 3.6 รายงานและการส่งออก

```mermaid
flowchart LR
  A[เลือกประเภท + ช่วงเวลา] --> B[computeAttendance_<br/>DailySummary + ใบลาที่อนุมัติ + ปฏิทิน + เวลาทำงาน]
  B --> C[แสดงบนหน้าเว็บ:<br/>หัวรายงาน / สรุปผล / กราฟ / ตาราง]
  C --> D[Export Excel/PDF:<br/>สร้าง Google Sheet ชั่วคราวพร้อมหัวกระดาษ → export → ย้ายไฟล์ชั่วคราวลงถังขยะ]
  C --> E[พิมพ์: หน้าพิมพ์ A4 แนวนอนพร้อมช่องลงนาม]
```

## 4. นิยามสถานะการปฏิบัติงานรายวัน

| สถานะ | เงื่อนไข |
|---|---|
| มาปฏิบัติงาน (`PRESENT`) | วันทำงาน และลงเวลาเข้าไม่เกินเวลาที่ถือว่ามาสาย |
| มาสาย (`LATE`) | ลงเวลาเข้าหลัง `LATE_AFTER_TIME` (นับนาทีที่สายจาก `WORK_START_TIME`) — ยกเว้นมีใบลาครึ่งวันเช้า |
| ลา (`LEAVE`) | มีใบลาที่อนุมัติ และไม่ได้ลงเวลา |
| ขาดงาน (`ABSENT`) | วันทำงาน ไม่มีการลงเวลา ไม่มีใบลา และพ้นเวลาเลิกงานของวันนั้นแล้ว |
| ยังไม่ลงเวลา (`NOT_YET`) | วันนี้ ยังไม่ถึงเวลาเลิกงาน และยังไม่ลงเวลา |
| ไม่ลงเวลาออก | ลงเวลาเข้าแต่ไม่ลงเวลาออก เมื่อพ้นเวลาเลิกงานแล้ว (นับเป็น “ลงเวลาไม่ครบ”) |
| ไม่ลงเวลาเข้า | มีเวลาออก (จากคำร้อง) แต่ไม่มีเวลาเข้า (นับเป็น “ลงเวลาไม่ครบ”) |
| ออกก่อนเวลา | ลงเวลาออกก่อน `WORK_END_TIME` (บันทึกได้ แต่ติดสถานะ) |
| วันหยุด / ปฏิบัติงานวันหยุด | ไม่ใช่วันทำงานตาม `WORK_DAYS` + ปฏิทิน (ถ้าลงเวลาในวันหยุด = ปฏิบัติงานวันหยุด) |

- วันก่อน `ActiveFrom` (วันที่อนุมัติบัญชี) และหลัง `ActiveTo` (วันที่ปิดใช้งาน) ไม่ถูกนับ
- **ร้อยละการมาปฏิบัติงาน** = วันที่มา ÷ (วันทำงาน − วันลา) × 100

## 5. โครงสร้างไฟล์โค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `src/Code.gs` | `doGet`, `include`, `getPublicConfig`, ตัวกระจายคำสั่ง `api()` + ตารางสิทธิ์, ค่าคงที่, ฟังก์ชันวันที่/เวลา (พ.ศ.) |
| `src/Auth.gs` | สมัครสมาชิก, เข้าสู่ระบบ, Lockout, Session, เปลี่ยนรหัสผ่าน, `CreateFirstAdmin`, `EmergencyResetAdmin`, `BenchmarkPasswordHashing` |
| `src/Crypto.gs` | SHA-256 / HMAC / PBKDF2-HMAC-SHA256 (JavaScript ล้วน), Salt, Pepper, รหัสผ่านชั่วคราวแบบสุ่ม |
| `src/Attendance.gs` | Haversine, Geofencing, ลงเวลาเข้า/ออก (LockService), Dashboard บุคลากร, ประวัติรายเดือน |
| `src/Leave.gs` | ใบลา, คำร้องแก้ไขเวลา, ไฟล์แนบ (ตรวจชนิดไฟล์จริง, ตรวจสิทธิ์ก่อนดาวน์โหลด) |
| `src/Admin.gs` | ภาพรวม, จัดการสมาชิก, ตั้งค่า, ปฏิทิน, Audit Log, คำนวณสรุปใหม่ |
| `src/Reports.gs` | คำนวณสถานะรายวัน, รายงานรายวัน/เดือน/ปี/บุคคล, Export Excel/PDF |
| `src/Database.gs` | Schema 9 ชีต, `SetupSystem()`, CRUD, แคชแบบมีเวอร์ชัน, Audit, งานบำรุงรักษา (`DailyMaintenance`) |
| `src/Index.html` | โครงหน้าเว็บหลัก (Template) |
| `src/Login.html`, `src/Register.html`, `src/Dashboard.html` | หน้าเข้าสู่ระบบ, สมัครสมาชิก, หน้าบุคลากร + บังคับเปลี่ยนรหัสผ่าน |
| `src/AdminDashboard.html`, `src/AdminScript.html` | หน้าผู้บริหาร/ผู้ดูแล — **ส่งให้เฉพาะผู้มีสิทธิ์ผ่าน `api('admin.view')`** ไม่ฝังในหน้าเว็บของทุกคน |
| `src/Styles.html` | Design System (สี, การ์ด, ปุ่ม, ตาราง, Responsive, หน้าพิมพ์) |
| `src/JavaScript.html` | Client หลัก: เรียก API, Auth, GPS, ประวัติ, การลา, คำร้อง |
| `src/appsscript.json` | Manifest: Timezone Asia/Bangkok, V8, OAuth scopes, การตั้งค่า Web App (ชุดติดตั้งแบบง่ายไม่ต้องแก้ — Apps Script ตรวจสิทธิ์จากโค้ดอัตโนมัติ) |
| `dist/Code.gs`, `dist/Index.html`, `dist/Admin.html` | **ชุดติดตั้งแบบง่าย** — รวมไฟล์ทั้งหมดข้างต้นเหลือ 3 ไฟล์ (สร้างด้วย `tools/build-bundle.js`) ทำงานเหมือนกันทุกประการ |

## 6. การออกแบบ UI/UX

### 6.1 แนวทาง

- **Modern Dashboard / Professional School Management** — การ์ดมุมโค้ง เงานุ่ม ไอคอน Material Symbols แถบหัวสี Navy ไล่สีไป Sky Blue
- **สี**: Navy `#0B2545` `#13315C` `#1B4F8A` · Sky Blue `#2E9BE0` `#4FB3F0` · White · สำเร็จ = เขียว `#16A34A` · ผิดพลาด = แดง `#DC2626` · เตือน = อำพัน
- **ตัวอักษร**: Sarabun (เนื้อหา) + Prompt (หัวข้อ) จาก Google Fonts (ฟรี)
- **Mobile First**: ออกแบบจอ 360–430 px ก่อน แล้วขยายเป็น 2 คอลัมน์ (≥ 900 px) และมีเมนูด้านซ้ายสำหรับหน้า Admin (≥ 1024 px)
- **ปุ่มใหญ่** สูง ≥ 46 px (ปุ่มลงเวลา 88 px), ช่องกรอกสูง 48 px ตัวอักษร 16 px (ป้องกัน iOS ซูมอัตโนมัติ)
- **ภาษาไทยเป็นหลัก**, วันที่ พ.ศ. เช่น “วันจันทร์ที่ 9 พฤศจิกายน พ.ศ. 2569”, นาฬิกาอ้างอิงเวลา Server (Asia/Bangkok)
- **สถานะไม่ใช้สีอย่างเดียว** — ทุก Badge มีไอคอน + ข้อความ, กราฟมีคำอธิบายสัญลักษณ์และตารางตัวเลขประกอบ
- **กราฟ** ใช้ชุดสี เขียว (ตรงเวลา) · น้ำเงิน (ลา) · อำพัน (สาย) · แดง (ขาด) ที่ผ่านการตรวจความแตกต่างสำหรับผู้มีภาวะตาบอดสี; สัดส่วนสถานะรายวันใช้แถบแบ่งส่วน (อ่านง่ายกว่ากราฟวงกลม); ไม่ใช้กราฟสองแกน (ร้อยละแยกเป็นกราฟเส้นของตัวเอง)

### 6.2 หน้าจอทั้งหมด

| หน้าจอ | องค์ประกอบหลัก |
|---|---|
| เริ่มต้นใช้งานระบบ (ครั้งแรก) | รหัสติดตั้ง + ข้อมูลผู้ดูแลระบบคนแรก + ปุ่มใช้ตำแหน่งปัจจุบันเป็นพิกัดโรงเรียน + เวลาทำงาน |
| เข้าสู่ระบบ | ชื่อระบบ/โรงเรียน/คำขวัญ, Username, Password (แสดง/ซ่อน), จดจำชื่อผู้ใช้, ลืมรหัสผ่าน (อธิบายขั้นตอน), ปุ่มสมัครสมาชิก, นโยบายข้อมูล |
| สมัครสมาชิก | ฟอร์ม 6 ช่อง, ตัวชี้วัดความแข็งแรงรหัสผ่าน + เช็กลิสต์เกณฑ์, ยินยอมนโยบาย GPS, หน้าสำเร็จพร้อมเลขอ้างอิง |
| บังคับเปลี่ยนรหัสผ่าน | สำหรับ Admin คนแรก/บัญชีที่ถูกรีเซ็ตรหัสผ่าน |
| ลงเวลา (หน้าหลัก) | ทักทาย + ตำแหน่ง, นาฬิกา Server + วันที่ พ.ศ. + เวลาทำงาน, **ปุ่มลงเวลาเข้า/ออกขนาดใหญ่**, สถานะวันนี้ (เวลาเข้า/ออก/สาย/ระยะทาง), สถานะ GPS + ตรวจสอบตำแหน่ง + วิธีเปิด GPS, สรุปเดือน 5 การ์ด, ประวัติล่าสุด |
| ประวัติ | เลือกเดือน/ปี (พ.ศ.), สรุป, ตารางรายวัน |
| การลา / แก้ไขเวลา | ฟอร์ม + แนบไฟล์ (ย่อรูปอัตโนมัติ), รายการพร้อมสถานะ, ยกเลิกได้เมื่อรออนุมัติ |
| บัญชี | ข้อมูลส่วนตัว, เปลี่ยนรหัสผ่าน, นโยบาย GPS, ออกจากระบบ |
| Admin: ภาพรวม | การ์ด 8 รายการ (ทั้งหมด/มา/สาย/ลา/ขาด/ยังไม่ลง/ไม่ครบ/รออนุมัติ), แถบสัดส่วนสถานะ, กราฟ 7 วันทำงาน, ตารางรายบุคคลวันนี้ |
| Admin: อนุมัติสมาชิก / จัดการสมาชิก | การ์ดผู้สมัคร (อนุมัติพร้อมเลือกบทบาท/ไม่อนุมัติพร้อมเหตุผล), ตารางค้นหา/กรอง, เมนูจัดการรายคน |
| Admin: ลา / คำร้อง | กรองตามสถานะ, ดูเอกสารแนบ, อนุมัติ/ไม่อนุมัติ/ยกเลิกการอนุมัติ, แสดงเวลาเดิมในระบบเทียบกับที่ขอแก้ |
| Admin: รายงาน | รายวัน/รายเดือน/รายปี/รายบุคคล, หัวรายงานทางการ, สรุปผล, กราฟ, ตาราง, Export Excel/PDF, พิมพ์ |
| Admin: ปฏิทิน / ตั้งค่า / Audit Log | ตามคู่มือ Admin |

ภาพหน้าจอจริงจากการทดสอบอัตโนมัติอยู่ใน [`docs/screenshots/`](screenshots/) (ถ่ายใน sandbox ที่ไม่มีอินเทอร์เน็ต ไอคอนจึงแสดงเป็นจุดแทน และใช้ฟอนต์ไทยของระบบแทน Sarabun)

| มือถือ: เข้าสู่ระบบ | มือถือ: ลงเวลา | มือถือ: ลงเวลาสำเร็จ | มือถือ: อยู่นอกพื้นที่ |
|---|---|---|---|
| ![](screenshots/01-login-mobile.png) | ![](screenshots/03-home-mobile.png) | ![](screenshots/04-checkin-success-mobile.png) | ![](screenshots/05-checkin-outside-mobile.png) |

| Admin: ภาพรวม | Admin: รายงานรายเดือน |
|---|---|
| ![](screenshots/07-admin-overview-desktop.png) | ![](screenshots/08-report-monthly-desktop.png) |

| ใบลาแบบราชการ (พิมพ์ A4) | มือถือ: สถิติการลา | มือถือ: ตัวอักษรใหญ่มาก | ผู้บริหาร: สรุปวันลา/มาสายรายรอบ |
|---|---|---|---|
| ![](screenshots/14-leave-form-print.png) | ![](screenshots/15-leave-stats-mobile.png) | ![](screenshots/16-large-text-mobile.png) | ![](screenshots/17-leave-summary-desktop.png) |

| แชร์ระบบ / QR Code | ประกาศ QR (พิมพ์ A4) | บัตรเข้าใช้งาน (8 ใบ/A4) | มือถือ: เตือนลงเวลาไม่ครบ |
|---|---|---|---|
| ![](screenshots/18-share-qr-desktop.png) | ![](screenshots/19-qr-poster-print.png) | ![](screenshots/20-login-slips-print.png) | ![](screenshots/21-issues-mobile.png) |

| มือถือ: ลงเวลาเข้าหลังเวลาสาย (ลืมกด?) | ผู้บริหาร: บันทึกเวลาแทน |
|---|---|
| ![](screenshots/22-forgot-checkin-mobile.png) | ![](screenshots/23-record-time-desktop.png) |

| แอดมิน: ตั้งค่าเริ่มต้นให้ครบ | ผู้อำนวยการ: งานรออนุมัติบนหน้าแรก |
|---|---|
| ![](screenshots/24-setup-checklist-mobile.png) | ![](screenshots/25-approvals-home-mobile.png) |

| บัญชีลงเวลาปฏิบัติราชการ (แบบสมุดลงเวลา) | มือถือ: ประกาศถึงบุคลากร |
|---|---|
| ![](screenshots/26-signbook-print.png) | ![](screenshots/27-announcement-mobile.png) |
