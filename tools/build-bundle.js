/**
 * build-bundle.js — สร้าง "ชุดติดตั้งแบบง่าย" 3 ไฟล์ใน dist/ จากโค้ดใน src/
 *
 *   dist/Code.gs      ← รวมไฟล์ .gs ทั้งหมด
 *   dist/Index.html   ← หน้าเว็บหลัก (รวม Styles/Login/Register/Dashboard/JavaScript แล้ว)
 *   dist/Admin.html   ← หน้าผู้บริหาร/ผู้ดูแลระบบ (ส่งให้เฉพาะผู้มีสิทธิ์)
 *
 * รัน: node tools/build-bundle.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const DIST = path.join(__dirname, '..', 'dist');
const GS_ORDER = ['Code', 'Database', 'Crypto', 'Auth', 'Attendance', 'Leave', 'Admin', 'Reports'];
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const version = (/VERSION:\s*'([^']+)'/.exec(read('Code.gs')) || [])[1] || '';
const banner = (what) => [
  '/*',
  ' * ระบบลงเวลาปฏิบัติงานออนไลน์ โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่ — v' + version,
  ' * ชุดติดตั้งแบบง่าย: ' + what,
  ' * ไฟล์นี้สร้างอัตโนมัติจากโฟลเดอร์ src/ ด้วย tools/build-bundle.js — แก้ไขที่ src/ แล้วสร้างใหม่',
  ' */', ''].join('\n');

fs.mkdirSync(DIST, { recursive: true });

// 1) Code.gs
const gsFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).map(f => f.replace(/\.gs$/, ''));
const missing = gsFiles.filter(f => !GS_ORDER.includes(f));
if (missing.length) throw new Error('เพิ่มไฟล์ต่อไปนี้ใน GS_ORDER: ' + missing.join(', '));
const code = banner('ไฟล์ Code.gs (โค้ดฝั่ง Server ทั้งหมด)') +
  GS_ORDER.map(n => '/* ' + '='.repeat(70) + '\n * ' + n + '.gs\n * ' + '='.repeat(70) + ' */\n' + read(n + '.gs').trim() + '\n').join('\n');
fs.writeFileSync(path.join(DIST, 'Code.gs'), code);

// 2) Index.html — แทน include() ด้วยเนื้อหาจริง
let index = read('Index.html');
index = index.replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (m, name) => {
  const content = read(name + '.html');
  if (content.includes('<?')) throw new Error(name + '.html มี <? ซึ่งจะถูกตีความเป็น scriptlet');
  return content.trim();
});
if (/include\(/.test(index)) throw new Error('ยังมี include() เหลือใน Index.html');
index = index.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- ' + banner('ไฟล์ Index.html').replace(/\/\*|\*\//g, '').trim() + ' -->');
fs.writeFileSync(path.join(DIST, 'Index.html'), index);

// 3) Admin.html — HTML + สคริปต์หน้าผู้ดูแลระบบ
const admin = '<!-- ' + banner('ไฟล์ Admin.html (หน้าผู้บริหาร/ผู้ดูแลระบบ)').replace(/\/\*|\*\//g, '').trim() + ' -->\n' +
  read('AdminDashboard.html').trim() + '\n' + read('AdminScript.html').trim() + '\n';
fs.writeFileSync(path.join(DIST, 'Admin.html'), admin);

// 4) appsscript.json (ไม่บังคับ — Apps Script ตรวจสิทธิ์ที่ต้องใช้จากโค้ดให้อัตโนมัติ)
fs.copyFileSync(path.join(SRC, 'appsscript.json'), path.join(DIST, 'appsscript.json'));

const kb = (f) => (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(0) + ' KB';
console.log('dist/Code.gs ' + kb('Code.gs') + ' · dist/Index.html ' + kb('Index.html') + ' · dist/Admin.html ' + kb('Admin.html'));
