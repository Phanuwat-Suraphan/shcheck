/**
 * สร้างเอกสารโครงสร้างฐานข้อมูล (docs/02-database.md) จาก SCHEMA_ ใน src/Database.gs
 * รัน: node tools/gen-db-doc.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createGasEnv } = require('../tests/gas-mock');
const c = createGasEnv().context;
const TYPE = { str: 'ข้อความ', date: 'วันที่ (yyyy-MM-dd, ค.ศ.)', time: 'เวลา (HH:mm:ss)', datetime: 'วันเวลา (yyyy-MM-dd HH:mm:ss)', num: 'ตัวเลข', bool: 'TRUE/FALSE' };
const PURPOSE = {
  Employees: 'ข้อมูลบุคลากรและบัญชีผู้ใช้ (1 แถว = 1 คน)',
  AttendanceLogs: 'บันทึกการลงเวลาทุกครั้ง แบบเพิ่มต่อท้าย ไม่มีการลบ — การแก้ไขเวลาจะเพิ่มรายการใหม่ และทำเครื่องหมายรายการเดิม (IsActive=FALSE, SupersededBy) เก็บไว้เป็นประวัติ',
  DailySummary: 'สรุปรายวันต่อคน (1 แถว = 1 คน/1 วัน) ใช้เร่งความเร็วรายงาน คำนวณใหม่ได้จาก AttendanceLogs เสมอ',
  WorkCalendar: 'วันหยุดราชการ วันหยุดพิเศษ และวันทำงานพิเศษ (1 แถว = 1 วัน)',
  Settings: 'การตั้งค่าระบบแบบ Key/Value (แก้ไขผ่านหน้าตั้งค่าระบบ)',
  LeaveRequests: 'ใบลา (1 แถว = 1 ใบลา)',
  CorrectionRequests: 'คำร้องแก้ไขเวลาเข้า/ออก (1 แถว = 1 คำร้อง)',
  AuditLogs: 'ประวัติการกระทำสำคัญทั้งหมด แบบเพิ่มต่อท้ายเท่านั้น',
  Sessions: 'ประวัติการเข้า/ออกจากระบบ (ไม่เก็บ token จริง)'
};
const out = ['# โครงสร้างฐานข้อมูล Google Sheets', '',
  '> เอกสารนี้สร้างอัตโนมัติจาก `SCHEMA_` ใน `src/Database.gs` ด้วยคำสั่ง `node tools/gen-db-doc.js` — ตรงกับโค้ดเสมอ', '',
  'ฟังก์ชัน `SetupSystem()` สร้างชีตทั้งหมดพร้อมหัวตาราง (แถวที่ 1) และคำอธิบายภาษาไทยเป็น Note บนหัวคอลัมน์ ',
  'เรียกซ้ำได้โดยไม่ลบข้อมูลเดิม และจะเพิ่มเฉพาะคอลัมน์ที่ขาด (ระบบอ้างอิงคอลัมน์ด้วยชื่อหัวตาราง ไม่ใช่ลำดับ)', '',
  '## หลักการจัดเก็บ', '',
  '- ข้อความทุกช่องบันทึกโดยนำหน้าด้วย `\'` → Google Sheets ไม่แปลง `00123` เป็นตัวเลข หรือ `2026-11-08` เป็นวันที่ และป้องกัน Formula Injection (`=IMPORTXML(...)`)',
  '- วันที่เก็บเป็น ค.ศ. รูปแบบ `yyyy-MM-dd` และเวลาเป็นเวลาไทย (Asia/Bangkok) จาก Server — หน้าเว็บแปลงเป็น พ.ศ. ตอนแสดงผล',
  '- รหัสผ่านเก็บเฉพาะค่า Hash (`pbkdf2_sha256$รอบ$salt$hash`) ไม่มีรหัสผ่านจริง',
  '- ห้ามแก้ไขชีตโดยตรงในงานประจำวัน (ชีตสำคัญตั้ง Protection แบบเตือน) ให้แก้ผ่านหน้าเว็บเพื่อให้มี Audit Log', '',
  '## สรุปชีต', '', '| ชีต | วัตถุประสงค์ | จำนวนคอลัมน์ |', '|---|---|---|'];
Object.keys(c.SCHEMA_).forEach(n => out.push(`| \`${n}\` | ${PURPOSE[n]} | ${c.SCHEMA_[n].cols.length} |`));
Object.keys(c.SCHEMA_).forEach(n => {
  out.push('', `## ${n}`, '', PURPOSE[n], '', '| # | คอลัมน์ (Header) | ชนิดข้อมูล | คำอธิบาย |', '|---|---|---|---|');
  c.SCHEMA_[n].cols.forEach((col, i) => out.push(`| ${i + 1} | \`${col[0]}\` | ${TYPE[col[1]]} | ${col[2]} |`));
});
out.push('', '## ค่าเริ่มต้นในชีต Settings', '', '| Key | ค่าเริ่มต้น | คำอธิบาย |', '|---|---|---|');
c.DEFAULT_SETTINGS_.forEach(d => out.push(`| \`${d[0]}\` | ${d[1] === '' ? (/ว่าง = ไม่ใช้/.test(d[2]) ? '(ว่าง)' : '(ว่าง — ต้องตั้งค่า)') : '`' + d[1] + '`'} | ${d[2]} |`));
out.push('', '## Script Properties (เก็บนอก Google Sheets — ไม่เปิดเผยต่อผู้ใช้)', '',
  '| Property | สร้างโดย | คำอธิบาย |', '|---|---|---|',
  '| `SPREADSHEET_ID` | SetupSystem | รหัส Spreadsheet ฐานข้อมูล (ไม่ส่งไปหน้าเว็บ) |',
  '| `PASSWORD_PEPPER` | SetupSystem | กุญแจลับ 256 บิต ผสมกับรหัสผ่านก่อน Hash — **ห้ามลบ/แก้ไข** มิฉะนั้นทุกคนจะเข้าสู่ระบบไม่ได้ |',
  '| `PBKDF2_ITERATIONS` | SetupSystem | จำนวนรอบ PBKDF2 (ค่าเริ่มต้น 100000) ปรับได้ |',
  '| `DRIVE_ROOT_FOLDER_ID`, `ATTACHMENT_FOLDER_ID`, `EXPORT_FOLDER_ID` | SetupSystem | โฟลเดอร์ Google Drive สำหรับเอกสารแนบ/ไฟล์รายงานชั่วคราว |',
  '| `CACHE_VER_*` | ระบบ | เวอร์ชันแคชของตาราง (เปลี่ยนอัตโนมัติเมื่อข้อมูลเปลี่ยน) |',
  '| `SETUP_CODE` | ติดตั้งอัตโนมัติ/SetupSystem | รหัสติดตั้งครั้งแรก (ใช้ครั้งเดียว) แสดงในชีตชั่วคราว `เริ่มต้นใช้งาน` — ลบอัตโนมัติเมื่อสร้างผู้ดูแลระบบแล้ว |',
  '| `BOOTSTRAP_ADMIN_*` | ผู้พัฒนา | (ทางเลือก) ข้อมูลสร้าง Admin คนแรกด้วย `CreateFirstAdmin()` (`BOOTSTRAP_ADMIN_PASSWORD` ถูกลบอัตโนมัติหลังใช้) |', '',
  '## ชีตชั่วคราว `เริ่มต้นใช้งาน`', '',
  'สร้างขึ้นเมื่อระบบยังไม่มีผู้ดูแลระบบ แสดงรหัสติดตั้งสำหรับหน้า “เริ่มต้นใช้งานระบบ” และถูกลบอัตโนมัติเมื่อสร้างผู้ดูแลระบบคนแรกสำเร็จ (ไม่ใช่ส่วนหนึ่งของฐานข้อมูลถาวร)', '');
fs.writeFileSync(path.join(__dirname, '..', 'docs', '02-database.md'), out.join('\n'));
console.log('written docs/02-database.md');
