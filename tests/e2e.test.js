/**
 * e2e.test.js — ทดสอบหน้าเว็บจริงทั้งระบบด้วย Chromium (Playwright) + GPS จำลอง
 * รัน: node tests/e2e.test.js   (ผลลัพธ์: tests/results/e2e-results.md, ภาพหน้าจอ: docs/screenshots/)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');
const { createApp, DEFAULTS } = require('./e2e-server');
const { decode: decodeQR } = require('./qr-decode');

const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
const SCHOOL = DEFAULTS.school;
const INSIDE = { latitude: SCHOOL.lat + 0.0004, longitude: SCHOOL.lng, accuracy: 12 };
const OUTSIDE = { latitude: SCHOOL.lat + 0.004, longitude: SCHOOL.lng + 0.002, accuracy: 10 };
const ADMIN_NEW_PW = 'NewAdmin2026ok';

// Chart.js stub (ไม่มีอินเทอร์เน็ตใน sandbox ทดสอบ) — บันทึก config ที่ระบบส่งให้ Chart.js เพื่อตรวจสอบ
const CHART_STUB = `window.Chart = function (el, cfg) {
  (window.__charts = window.__charts || []).push({ id: el.id, type: cfg.type, labels: cfg.data.labels, datasets: cfg.data.datasets.map(function (d) { return { label: d.label, data: d.data, color: d.backgroundColor }; }) });
  var c = el.getContext('2d'); c.fillStyle = '#E3F2FD'; c.fillRect(0, 0, el.width, el.height);
  var n = cfg.data.labels.length, w = el.width / Math.max(n, 1);
  cfg.data.datasets.forEach(function (d, di) { c.fillStyle = typeof d.backgroundColor === 'string' ? d.backgroundColor : '#2A78D6';
    d.data.forEach(function (v, i) { if (v) c.fillRect(i * w + w * 0.2, el.height - 10 - (v * 18) - di * 4, w * 0.6, v * 18); }); });
  this.destroy = function () {};
};
window.Chart.defaults = { font: {} };`;
// Google Fonts ถูกบล็อกใน sandbox: แทนไอคอนด้วยจุดเพื่อไม่ให้ข้อความชื่อไอคอนรบกวนภาพหน้าจอ
const ICON_PLACEHOLDER_CSS = `.ms{-webkit-text-fill-color:transparent;background:radial-gradient(circle at 50% 50%,currentColor 0 30%,transparent 33%)}`;

const results = [];
let browser, app, base;
const pageErrors = [];

async function newPage(o = {}) {
  const ctx = await browser.newContext(Object.assign({}, o.desktop ? { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } : devices['Pixel 7'], {
    geolocation: o.geo || INSIDE, permissions: ['geolocation'], locale: 'th-TH', timezoneId: 'Asia/Bangkok', acceptDownloads: true
  }));
  await ctx.route(/cdnjs\.cloudflare\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART_STUB }));
  await ctx.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: ICON_PLACEHOLDER_CSS }));
  await ctx.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const page = await ctx.newPage();
  page.setDefaultTimeout(+(process.env.PW_TIMEOUT || 10000));
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(o.base || base);
  await page.waitForSelector('#view-login:not([hidden]), #view-app:not([hidden]), #view-setup:not([hidden])', { timeout: 15000 });
  return page;
}
async function login(page, u, p) {
  await page.fill('#loginUsername', u);
  await page.fill('#loginPassword', p);
  await page.click('#loginBtn');
}
async function modalAction(page, label) {
  await page.locator('.modal-actions .btn', { hasText: label }).last().click();
}
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
}
async function step(id, name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ id, name, ok: true, ms: Date.now() - t }); console.log(`✔ ${id} ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push({ id, name, ok: false, ms: Date.now() - t, err: e.message }); console.log(`✘ ${id} ${name}\n   ${e.message.split('\n').slice(0, +(process.env.ERR_LINES || 4)).join('\n   ')}`); }
}
function setClock(t) { return fetch(base + '/__clock?' + encodeURIComponent(t)); }
/** เรนเดอร์ HTML ที่ส่งไปพิมพ์ด้วย CSS จริงของหน้า → PDF (นับหน้า) + ภาพหน้าจอ */
async function printPreview(fromPage, html, orientation, shotName) {
  const css = await fromPage.evaluate(() => Array.from(document.querySelectorAll('style')).map(x => x.textContent).join('\n'));
  const portrait = orientation === 'portrait';
  const pg = await browser.newPage({ viewport: portrait ? { width: 794, height: 1123 } : { width: 1123, height: 794 } });
  await pg.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style><style>@page { size: A4 ' + orientation + '; margin: ' + (portrait ? '14mm 16mm' : '12mm') + '; }</style></head>' +
    '<body class="printing"><div id="printArea" class="print-area">' + html + '</div></body></html>');
  await pg.emulateMedia({ media: 'print' });
  const pdf = await pg.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (shotName) {
    await pg.evaluate(() => { document.body.style.padding = '40px 52px'; });
    fs.mkdirSync(SHOTS, { recursive: true });
    await pg.screenshot({ path: path.join(SHOTS, shotName), fullPage: true });
  }
  await pg.close();
  return pages;
}
async function capturePrint(page) {
  await page.evaluate(() => { window.__printHtml = null; if (!window.__capturing) { const o = window.print; window.print = () => { window.__printHtml = document.getElementById('printArea').innerHTML; o(); }; window.__capturing = true; } });
}
async function toast(page, re) { await page.locator('.toast', { hasText: re }).first().waitFor({ timeout: 8000 }); }

(async function main() {
  app = createApp();
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
  browser = await chromium.launch();
  const t0 = Date.now();
  let admin, teacher, teacherRef;

  await step('E01', 'หน้าเข้าสู่ระบบแสดงชื่อระบบ/โรงเรียน/คำขวัญ และปุ่มสมัครสมาชิก (มือถือ)', async () => {
    admin = await newPage();
    assert.ok(await admin.isVisible('#view-login'));
    const hero = await admin.textContent('#view-login .auth-hero');
    ['ระบบลงเวลาปฏิบัติงานออนไลน์', 'โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่', 'Wat Sao Hin School Attendance System', 'ระบบลงเวลาอัจฉริยะ สะดวก โปร่งใส ตรวจสอบได้'].forEach(t => assert.ok(hero.includes(t), t));
    assert.ok(await admin.isVisible('#goRegisterBtn'));
    await admin.click('[data-toggle-pw="loginPassword"]');
    assert.strictEqual(await admin.getAttribute('#loginPassword', 'type'), 'text');
    await admin.click('[data-toggle-pw="loginPassword"]');
    await shot(admin, '01-login-mobile.png');
  });

  await step('E02', 'Admin คนแรกเข้าสู่ระบบ → ถูกบังคับเปลี่ยนรหัสผ่าน → เข้าสู่หน้าลงเวลา', async () => {
    await login(admin, DEFAULTS.adminUser, 'wrong-password1');
    await admin.waitForSelector('#loginAlert:not([hidden])');
    assert.ok(/ไม่ถูกต้อง/.test(await admin.textContent('#loginAlertText')));
    await login(admin, DEFAULTS.adminUser, DEFAULTS.adminPass);
    await admin.waitForSelector('#view-force-password:not([hidden])');
    await admin.fill('#fpCurrent', DEFAULTS.adminPass);
    await admin.fill('#fpNew', ADMIN_NEW_PW);
    await admin.fill('#fpConfirm', ADMIN_NEW_PW);
    await admin.click('#forcePwForm button[type=submit]');
    await admin.waitForSelector('#view-app:not([hidden])');
    await admin.waitForFunction(() => document.querySelector('#homeName').textContent.includes('ผู้ดูแล'));
    assert.ok(await admin.isVisible('#toAdminBtn'));
  });

  await step('E03', 'ออกจากระบบ (มีกล่องยืนยัน) → กลับหน้าเข้าสู่ระบบ, Token เดิมใช้ไม่ได้', async () => {
    const token = await admin.evaluate(() => sessionStorage.getItem('wsh_token'));
    await admin.click('#logoutBtn');
    await modalAction(admin, 'ออกจากระบบ');
    await admin.waitForSelector('#view-login:not([hidden])');
    await admin.waitForTimeout(400);
    const r = app.env.call('api', token, 'me.dashboard', {});
    assert.strictEqual(r.code, 'AUTH');
  });

  await step('E04', 'สมัครสมาชิก: ตรวจข้อมูลฝั่งหน้าเว็บ, เกณฑ์รหัสผ่าน, สมัครสำเร็จได้เลขอ้างอิง', async () => {
    teacher = await newPage();
    await teacher.click('#goRegisterBtn');
    await teacher.waitForSelector('#view-register:not([hidden])');
    await teacher.click('#registerBtn');
    assert.ok(await teacher.isVisible('[data-field="fullName"].has-error'));
    await teacher.fill('#regFullName', 'นางสาวสมศรี ใจดี');
    await teacher.selectOption('#regPosition', 'ครู');
    await teacher.fill('#regUsername', 'somsri.j');
    await teacher.fill('#regPassword', 'abc');
    await teacher.fill('#regConfirm', 'abc');
    assert.strictEqual(await teacher.locator('#regPwRules li.ok').count(), 2); // user + match
    await teacher.fill('#regPassword', 'Somsri2026ok');
    await teacher.fill('#regConfirm', 'Somsri2026ok');
    assert.strictEqual(await teacher.locator('#regPwRules li.ok').count(), 4);
    await teacher.click('#registerBtn');
    assert.ok(await teacher.isVisible('[data-field="acceptPrivacy"].has-error'));
    await teacher.check('#regAccept');
    await shot(teacher, '02-register-mobile.png');
    await teacher.click('#registerBtn');
    await teacher.waitForSelector('#registerDone:not([hidden])');
    teacherRef = (await teacher.textContent('#regDoneRef')).trim();
    assert.ok(/^EMP-/.test(teacherRef));
    const rec = app.env.SpreadsheetApp.openById(app.env.state.props.SPREADSHEET_ID).getSheetByName('Employees')._records().find(e => e.Username === 'somsri.j');
    assert.ok(/^T\d{3}$/.test(rec.StaffCode), 'ระบบกำหนดรหัสประจำตัวบุคลากรให้: ' + rec.StaffCode); assert.strictEqual(rec.Status, 'PENDING');
    assert.strictEqual((await teacher.textContent('#regDoneCode')).trim(), rec.StaffCode);
  });

  await step('E05', 'บัญชีรออนุมัติเข้าสู่ระบบ → แจ้ง "รอการอนุมัติ"', async () => {
    await teacher.click('#registerDone [data-go="login"]');
    await login(teacher, 'somsri.j', 'Somsri2026ok');
    await teacher.waitForSelector('#loginAlert:not([hidden])');
    assert.ok(/รอการอนุมัติ/.test(await teacher.textContent('#loginAlertText')));
  });

  await step('E06', 'Admin เปิดหน้าผู้ดูแล (โหลดหลังตรวจสิทธิ์) → อนุมัติสมาชิกพร้อมเลือกประเภทผู้ใช้', async () => {
    await login(admin, DEFAULTS.adminUser, ADMIN_NEW_PW);
    await admin.waitForSelector('#view-app:not([hidden])');
    await admin.click('#toAdminBtn');
    await admin.waitForSelector('#view-admin:not([hidden]) #ovStats .stat-card');
    assert.strictEqual(await admin.locator('#ovStats .stat-card').count(), 8);
    await admin.click('#adminNav [data-sec="registrations"]');
    await admin.waitForSelector('#regList [data-approve]');
    await admin.click('#regList [data-approve]');
    await admin.selectOption('#apRole', 'USER');
    await modalAction(admin, 'อนุมัติ');
    await toast(admin, /อนุมัติบัญชี/);
  });

  await step('E07', 'ครูลงเวลาเข้างานด้วย GPS ในรัศมี → สำเร็จ แสดงเวลา Server/สถานะ/ระยะทาง/ลิงก์แผนที่', async () => {
    await login(teacher, 'somsri.j', 'Somsri2026ok');
    await teacher.waitForSelector('#view-app:not([hidden])');
    await teacher.waitForFunction(() => document.querySelector('#clockTime').textContent !== '--:--:--');
    assert.ok(/วันจันทร์ที่ 9 พฤศจิกายน พ.ศ. 2569/.test(await teacher.textContent('#clockDate')));
    assert.ok(/อนุญาต/.test(await teacher.textContent('#gpsStatusText')));
    await teacher.click('#checkInBtn');
    await teacher.waitForSelector('.modal .result-hero.ok', { timeout: 15000 });
    const body = await teacher.textContent('.modal');
    assert.ok(/ลงเวลาเข้างานสำเร็จ/.test(body) && /07:50/.test(body) && /ตรงเวลา/.test(body) && /4[45] ม\./.test(body), body);
    assert.ok(await teacher.locator('.modal a[href*="openstreetmap.org"]').count() === 1);
    await shot(teacher, '04-checkin-success-mobile.png');
    await modalAction(teacher, 'เรียบร้อย');
    await teacher.waitForFunction(() => document.querySelector('#todayIn').textContent === '07:50');
  });

  await step('E08', 'ป้องกันการกดซ้ำ: ปุ่มเข้างานถูกปิดหลังลงเวลา และ Server ปฏิเสธการเรียกซ้ำ', async () => {
    assert.ok(await teacher.isDisabled('#checkInBtn'));
    assert.ok(await teacher.isEnabled('#checkOutBtn'));
    const r = await teacher.evaluate(() => new Promise(res => google.script.run.withSuccessHandler(res).api(sessionStorage.getItem('wsh_token'), 'att.checkIn', { lat: 18.7887, lng: 98.9853, accuracy: 10 })));
    assert.strictEqual(r.code, 'DUPLICATE');
    await teacher.evaluate(() => window.scrollTo(0, 0));
    await shot(teacher, '03-home-mobile.png');
  });

  await step('E09', 'ลงเวลาออกไม่ต้องตรวจ GPS (อยู่นอกโรงเรียนก็ลงได้) + ออกก่อนเวลามีกล่องยืนยัน → สถานะ "ออกก่อนเวลา"', async () => {
    await teacher.context().setGeolocation(OUTSIDE); // ครูออกจากโรงเรียนไปแล้ว
    // เลื่อนเวลา Server ไป 20 นาที (อยู่ในช่วงอายุ Session 30 นาที)
    await setClock('2026-11-09 08:10:00');
    await teacher.evaluate(() => { window.App.S.offsetMs += 20 * 60000; });
    await teacher.click('#checkOutBtn');
    await teacher.locator('.modal', { hasText: 'ยังไม่ถึงเวลาเลิกงาน' }).waitFor();
    await modalAction(teacher, 'ลงเวลาออก');
    await teacher.waitForSelector('.modal .result-hero.ok', { timeout: 15000 });
    const body = await teacher.textContent('.modal');
    assert.ok(/ออกก่อนเวลา/.test(body) && /ไม่ต้องตรวจตำแหน่ง/.test(body), body);
    await modalAction(teacher, 'เรียบร้อย');
    await teacher.waitForFunction(() => document.querySelector('#todayOut').textContent === '08:10');
    assert.ok(await teacher.isDisabled('#checkOutBtn'));
    const log = app.env.SpreadsheetApp.openById(app.env.state.props.SPREADSHEET_ID).getSheetByName('AttendanceLogs')._records().find(l => l.Type === 'OUT');
    assert.strictEqual(log.Source, 'NO_GPS');
    await teacher.context().setGeolocation(INSIDE);
  });

  let outsider;
  await step('E10', 'อยู่นอกรัศมีโรงเรียน → ลงเวลาไม่สำเร็จ แสดงระยะห่าง (สีแดง) และไม่บันทึกข้อมูล', async () => {
    await setClock('2026-11-09 08:12:00');
    const r = app.env.call('register', { fullName: 'นายสมชาย นอกพื้นที่', staffCode: '01002', position: 'ครู', username: 'somchai.n', password: 'Somchai2026ok', confirmPassword: 'Somchai2026ok', acceptPrivacy: true });
    const adminTok = await admin.evaluate(() => sessionStorage.getItem('wsh_token'));
    assert.ok(app.env.call('api', adminTok, 'emp.approve', { employeeId: r.data.reference, role: 'USER' }).ok);
    outsider = await newPage({ geo: OUTSIDE });
    await login(outsider, 'somchai.n', 'Somchai2026ok');
    await outsider.waitForSelector('#view-app:not([hidden])', { timeout: 15000 });
    const before = app.env.SpreadsheetApp.openById(app.env.state.props.SPREADSHEET_ID).getSheetByName('AttendanceLogs')._records().length;
    await outsider.click('#checkInBtn');
    await outsider.waitForSelector('.modal .result-hero.bad', { timeout: 15000 });
    const body = await outsider.textContent('.modal');
    assert.ok(/นอกพื้นที่โรงเรียน/.test(body) && /ห่าง/.test(body), body);
    await shot(outsider, '05-checkin-outside-mobile.png');
    await modalAction(outsider, 'ปิด');
    const after = app.env.SpreadsheetApp.openById(app.env.state.props.SPREADSHEET_ID).getSheetByName('AttendanceLogs')._records().length;
    assert.strictEqual(after, before);
    await outsider.click('#checkLocBtn');
    await outsider.waitForSelector('#zoneResult.out:not([hidden])', { timeout: 15000 });
  });

  await step('E11', 'ครูแจ้งลาแบบแตะครั้งเดียว: เลือกวัน → แตะ "ลาป่วย" → กล่องยืนยัน (แนบไฟล์ได้) → รออนุมัติ', async () => {
    await teacher.click('#userTabs [data-tab="leave"]');
    await teacher.waitForSelector('#leaveTypeGrid [data-type="SICK"]');
    assert.strictEqual(await teacher.inputValue('#leaveStart'), '2026-11-09'); // ค่าเริ่มต้น = วันนี้
    await teacher.click('#lvQuickDay [data-val="tomorrow"]');
    assert.strictEqual(await teacher.inputValue('#leaveStart'), '2026-11-10');
    await teacher.evaluate(() => window.scrollTo(0, 0));
    await shot(teacher, '11-leave-quick-mobile.png');
    await teacher.click('#leaveTypeGrid [data-type="SICK"]');
    await teacher.locator('.modal', { hasText: 'ยืนยันการลา' }).waitFor();
    assert.ok(/ลาป่วย/.test(await teacher.textContent('.modal .leave-summary')) && /10 พฤศจิกายน/.test(await teacher.textContent('.modal .leave-summary')));
    await teacher.fill('#lcReason', 'มีไข้ ไปพบแพทย์ <img src=x onerror="window.__xss=1">');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await teacher.setInputFiles('#lcFile', { name: 'medical-cert.png', mimeType: 'image/png', buffer: png });
    await shot(teacher, '12-leave-confirm-mobile.png');
    await modalAction(teacher, 'ยืนยันการลา');
    await toast(teacher, /ส่งใบลาเรียบร้อย/);
    await teacher.locator('#myLeaves .req-card', { hasText: 'ลาป่วย' }).waitFor();
    assert.ok(/รออนุมัติ/.test(await teacher.textContent('#myLeaves')));
    assert.ok(await teacher.locator('#myLeaves [data-view-att]').count() === 1);
    // ประเภท "อื่น ๆ" ต้องพิมพ์ชื่อการลา
    await teacher.click('#lvQuickDay [data-val="custom"]');
    await teacher.fill('#leaveStart', '2026-10-01'); await teacher.dispatchEvent('#leaveStart', 'change'); // ย้อนหลังได้
    await teacher.click('#leaveTypeGrid [data-type="OTHER"]');
    await modalAction(teacher, 'ยืนยันการลา');
    await teacher.waitForSelector('.modal [data-field="typeDetail"].has-error');
    await teacher.fill('#lcDetail', 'ลาไปช่วยเหลือภริยาที่คลอดบุตร');
    await modalAction(teacher, 'ยืนยันการลา');
    await toast(teacher, /ลาไปช่วยเหลือภริยาที่คลอดบุตร/);
    await teacher.locator('#myLeaves .req-card', { hasText: 'ลาไปช่วยเหลือภริยาที่คลอดบุตร' }).waitFor();
  });

  await step('E12', 'ครูยื่นคำร้องแก้ไขเวลาเข้างาน (มาถึงก่อนแต่ GPS ขัดข้อง) → แสดงในรายการ', async () => {
    await teacher.click('#userTabs [data-tab="correction"]');
    await teacher.fill('#corrDate', '2026-11-09');
    await teacher.fill('#corrTime', '07:30');
    await teacher.check('#corrForm input[value="IN"]');
    await teacher.fill('#corrReason', 'มาถึงโรงเรียน 07:30 น. แต่ GPS โทรศัพท์ขัดข้อง');
    await teacher.click('#corrForm button[type=submit]');
    await toast(teacher, /ส่งคำร้อง/);
    await teacher.locator('#myCorrections .req-card').first().waitFor();
  });

  await step('E13', 'ความปลอดภัย: ผู้ใช้ทั่วไปเรียกฟังก์ชัน Admin ผ่าน DevTools/google.script.run ไม่ได้', async () => {
    const out = await teacher.evaluate(async () => {
      const call = (fn, ...a) => new Promise(res => google.script.run.withSuccessHandler(res).withFailureHandler(e => res({ thrown: String(e.message) }))[fn](...a));
      const tk = sessionStorage.getItem('wsh_token');
      return {
        list: await call('api', tk, 'emp.list', {}),
        role: await call('api', tk, 'emp.setRole', { employeeId: 'x', role: 'ADMIN' }),
        view: await call('api', tk, 'admin.view', {}),
        settings: await call('api', tk, 'settings.save', { values: { GEOFENCE_RADIUS_M: '99999' } }),
        setup: await call('SetupSystem'),
        bootstrap: await call('CreateFirstAdmin'),
        inc: await call('include', 'AdminScript'),
        priv: await call('recordAttendance_', {}, 'IN', {}),
        noToken: await call('api', 'x'.repeat(64), 'me.dashboard', {})
      };
    });
    ['list', 'role', 'view', 'settings'].forEach(k => assert.strictEqual(out[k].code, 'FORBIDDEN', k + JSON.stringify(out[k])));
    assert.ok(/Apps Script Editor/.test(out.setup.thrown) && /Apps Script Editor/.test(out.bootstrap.thrown));
    assert.strictEqual(out.inc, '');
    assert.ok(out.priv.thrown);
    assert.strictEqual(out.noToken.code, 'AUTH');
    assert.ok(!(await teacher.content()).includes('data-panel-sec="settings"'));
  });

  await step('E14', 'Admin อนุมัติใบลา (ดูไฟล์แนบได้, ข้อความอันตรายแสดงเป็นตัวอักษร ไม่ถูกรันเป็นสคริปต์) และอนุมัติคำร้องแก้ไขเวลา', async () => {
    await admin.click('#adminNav [data-sec="leaves"]');
    await admin.waitForSelector('#lvList [data-lv="APPROVE"]');
    assert.ok((await admin.textContent('#lvList')).includes('<img src=x onerror='), 'XSS payload should be shown as text');
    assert.strictEqual(await admin.evaluate(() => window.__xss), undefined);
    assert.strictEqual(await teacher.evaluate(() => window.__xss), undefined);
    assert.strictEqual(await admin.locator('#lvList img').count(), 0);
    await admin.click('#lvList [data-view-att]');
    await admin.waitForSelector('.modal img');
    await modalAction(admin, 'ปิด');
    await admin.click('#lvList [data-lv="APPROVE"]');
    await modalAction(admin, 'อนุมัติ');
    await toast(admin, /อนุมัติใบลาแล้ว/);
    await admin.click('#adminNav [data-sec="corrections"]');
    await admin.waitForSelector('#crList [data-cr="APPROVE"]');
    assert.ok(/เข้า 07:50 \/ ออก 08:10/.test(await admin.textContent('#crList')));
    await admin.click('#crList [data-cr="APPROVE"]');
    await modalAction(admin, 'อนุมัติ');
    await toast(admin, /ปรับเวลาเรียบร้อย/);
    const logs = app.env.SpreadsheetApp.openById(app.env.state.props.SPREADSHEET_ID).getSheetByName('AttendanceLogs')._records();
    assert.strictEqual(logs.filter(l => l.IsActive === false).length, 1);
  });

  await step('E22', 'Admin บันทึกการลาให้ครู (เลือกคน → วันที่ → แตะประเภท → ยืนยัน) → อนุมัติทันที', async () => {
    await admin.click('#adminNav [data-sec="leaves"]');
    await admin.click('#lvRecordBtn');
    await admin.waitForSelector('#rlEmp option:nth-child(2)', { state: 'attached' });
    await admin.locator('#rlTypes [data-type="PERSONAL"]').click();
    await admin.waitForSelector('[data-field="employeeId"].has-error'); // ต้องเลือกบุคลากรก่อน
    const empId = await admin.evaluate(() => [...document.querySelectorAll('#rlEmp option')].find(o => /สมศรี/.test(o.textContent)).value);
    await admin.selectOption('#rlEmp', empId);
    await admin.click('#rlQuick [data-val="custom"]');
    await admin.fill('#rlStart', '2026-11-12'); await admin.dispatchEvent('#rlStart', 'change');
    await admin.locator('#rlTypes [data-type="PERSONAL"]').click();
    await admin.locator('.modal', { hasText: 'นางสาวสมศรี ใจดี' }).waitFor();
    await modalAction(admin, 'บันทึกการลา');
    await toast(admin, /บันทึกการลาให้ นางสาวสมศรี ใจดี เรียบร้อย/);
    const rec = app.env.SpreadsheetApp.openById(app.env.state.props.SPREADSHEET_ID).getSheetByName('LeaveRequests')._records().find(r => r.StartDate === '2026-11-12');
    assert.strictEqual(rec.Status, 'APPROVED'); assert.strictEqual(rec.LeaveType, 'PERSONAL');
  });

  await step('E15', 'รายงานรายวัน/รายเดือน/รายปี + กราฟ + Export Excel/PDF + พิมพ์รายงาน', async () => {
    await admin.click('#adminNav [data-sec="reports"]');
    await admin.fill('#repDate', '2026-11-09');
    await admin.click('#repRunBtn');
    await admin.waitForSelector('#repResult .report-head');
    const daily = await admin.textContent('#repResult');
    ['โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่', 'รายงานการลงเวลาปฏิบัติงานประจำวัน', 'วันจันทร์ที่ 9 พฤศจิกายน พ.ศ. 2569', 'นางสาวสมศรี ใจดี', '07:30', 'ยังไม่ลงเวลา', 'แก้ไขเวลาตามคำร้อง'].forEach(t => assert.ok(daily.includes(t), t));
    assert.ok(await admin.locator('#repSeg .segbar').count() === 1);
    const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click('[data-export="xlsx"]')]);
    assert.ok(/\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const buf = fs.readFileSync(await dl.path());
    assert.ok(buf.slice(0, 2).toString() === 'PK');
    const [dl2] = await Promise.all([admin.waitForEvent('download'), admin.click('[data-export="pdf"]')]);
    assert.ok(/\.pdf$/.test(dl2.suggestedFilename()));
    await admin.click('#repPrintBtn');
    await admin.waitForFunction(() => window.__printed === 1);
    await admin.click('#repTypeSeg [data-val="monthly"]');
    await admin.click('#repRunBtn');
    await admin.waitForFunction(() => (window.__charts || []).some(c => c.id === 'repChart1'));
    const charts = await admin.evaluate(() => window.__charts.filter(c => c.id === 'repChart1'));
    assert.deepStrictEqual(charts.pop().datasets.map(d => d.label), ['ตรงเวลา', 'ลา', 'มาสาย', 'ขาดงาน']);
    await admin.click('#repTypeSeg [data-val="yearly"]');
    await admin.click('#repRunBtn');
    await admin.waitForFunction(() => (window.__charts || []).some(c => c.id === 'repChart2' && c.type === 'line'));
  });

  await step('E16', 'รายงานรายบุคคลจากเมนูจัดการสมาชิก + รีเซ็ตรหัสผ่าน (แสดงรหัสชั่วคราวครั้งเดียว)', async () => {
    await admin.click('#adminNav [data-sec="members"]');
    await admin.waitForSelector('#memTable [data-manage]');
    const row = admin.locator('#memTable tr', { hasText: 'สมศรี' });
    await row.locator('[data-manage]').click();
    await admin.locator('.modal .btn', { hasText: 'ดูประวัติการลงเวลา' }).click();
    await admin.waitForSelector('#repResult .report-head');
    assert.ok(/รายงานการลงเวลาปฏิบัติงานรายบุคคล/.test(await admin.textContent('#repResult')));
    await admin.click('#adminNav [data-sec="members"]');
    await admin.waitForSelector('#memTable [data-manage]');
    await admin.locator('#memTable tr', { hasText: 'สมชาย' }).locator('[data-manage]').click();
    await admin.locator('.modal .btn', { hasText: 'รีเซ็ตรหัสผ่าน' }).click();
    await modalAction(admin, 'รีเซ็ตรหัสผ่าน');
    await admin.waitForSelector('.modal .temp-pass');
    const temp = (await admin.textContent('.modal .temp-pass')).trim();
    assert.ok(/^[A-Za-z2-9]{12}$/.test(temp), temp);
    await modalAction(admin, 'บันทึกแล้ว');
  });

  await step('E17', 'ตั้งค่าระบบ: แสดงค่าปัจจุบัน, ตรวจค่าผิด, บันทึกรัศมีใหม่สำเร็จ', async () => {
    await admin.click('#adminNav [data-sec="settings"]');
    await admin.waitForFunction(() => document.querySelector('#sLat').value !== '');
    assert.strictEqual(await admin.inputValue('#sRadius'), '150');
    assert.strictEqual(await admin.inputValue('#sAcc'), '50');
    await admin.fill('#sLate', '07:00');
    await admin.click('#setForm button[type=submit]');
    await admin.waitForSelector('[data-field="LATE_AFTER_TIME"].has-error');
    await admin.fill('#sLate', '08:30');
    await admin.fill('#sRadius', '200');
    await admin.click('#setForm button[type=submit]');
    await toast(admin, /บันทึกการตั้งค่าแล้ว/);
    assert.strictEqual(app.env.call('getPublicConfig').ok, true);
    const rows = app.env.SpreadsheetApp.openById(app.env.state.props.SPREADSHEET_ID).getSheetByName('Settings')._records();
    assert.strictEqual(rows.find(r => r.Key === 'GEOFENCE_RADIUS_M').Value, '200');
  });

  await step('E18', 'ปฏิทินวันหยุด: มีวันหยุดราชการไทยให้อัตโนมัติ, ผู้ดูแลเพิ่ม/แก้ไขวันหยุดของโรงเรียนได้', async () => {
    await admin.click('#adminNav [data-sec="calendar"]');
    await admin.locator('#calList', { hasText: 'วันหยุดชดเชยวันชาติและวันพ่อแห่งชาติ' }).waitFor();
    assert.ok((await admin.textContent('#calList')).includes('วันเข้าพรรษา'));
    await admin.locator('#calList tr', { hasText: 'วันสิ้นปี' }).locator('[data-edit-cal]').click();
    assert.strictEqual(await admin.inputValue('#calStart'), '2026-12-31');
    assert.strictEqual(await admin.inputValue('#calTitle'), 'วันสิ้นปี');
    await admin.fill('#calStart', '2026-12-28');
    await admin.dispatchEvent('#calStart', 'change');
    await admin.fill('#calTitle', 'ปิดภาคเรียน (ทดสอบ)');
    await admin.selectOption('#calType', 'SPECIAL_HOLIDAY');
    await admin.click('#calForm button[type=submit]');
    await toast(admin, /บันทึกปฏิทินแล้ว/);
    await admin.locator('#calList', { hasText: 'ปิดภาคเรียน (ทดสอบ)' }).waitFor();
  });

  await step('E23', 'ภาพหน้าจอปฏิทินวันหยุด (เดสก์ท็อป)', async () => {
    const desk = await newPage({ desktop: true });
    await login(desk, DEFAULTS.adminUser, ADMIN_NEW_PW);
    await desk.waitForSelector('#view-app:not([hidden])');
    await desk.click('#toAdminBtn');
    await desk.waitForSelector('#ovStats .stat-card');
    await desk.click('#adminNav [data-sec="calendar"]');
    await desk.locator('#calList', { hasText: 'วันมาฆบูชา' }).waitFor();
    await shot(desk, '13-calendar-desktop.png');
  });

  await step('E19', 'ภาพหน้าจอ Dashboard ผู้ดูแลระบบ (เดสก์ท็อป) และรายงานรายเดือน', async () => {
    const desk = await newPage({ desktop: true });
    await login(desk, DEFAULTS.adminUser, ADMIN_NEW_PW);
    await desk.waitForSelector('#view-app:not([hidden])');
    await shot(desk, '06-home-desktop.png');
    await desk.click('#toAdminBtn');
    await desk.waitForSelector('#ovStats .stat-card');
    await desk.waitForFunction(() => (window.__charts || []).some(c => c.id === 'ovTrend'));
    await shot(desk, '07-admin-overview-desktop.png');
    await desk.click('#adminNav [data-sec="reports"]');
    await desk.click('#repTypeSeg [data-val="monthly"]');
    await desk.click('#repRunBtn');
    await desk.waitForSelector('#repResult .report-head');
    await shot(desk, '08-report-monthly-desktop.png');
    await desk.click('#adminNav [data-sec="settings"]');
    await desk.waitForFunction(() => document.querySelector('#sLat').value !== '');
    await shot(desk, '09-settings-desktop.png');
  });

  await step('E21', 'ติดตั้งแบบง่าย: เปิดเว็บครั้งแรกหลัง Deploy → ระบบสร้างฐานข้อมูลเอง → กรอกรหัสติดตั้ง + ผู้ดูแลระบบ + พิกัด → เข้าใช้งานทันที', async () => {
    const fresh = createApp({ fresh: true });
    await new Promise(r => fresh.server.listen(0, '127.0.0.1', r));
    try {
      const page = await newPage({ base: 'http://127.0.0.1:' + fresh.server.address().port });
      await page.waitForSelector('#view-setup:not([hidden])');
      await shot(page, '10-first-run-setup-mobile.png');
      // เจ้าของระบบเปิด Google Sheet ฐานข้อมูล → ชีต "เริ่มต้นใช้งาน" เพื่อดูรหัส
      const code = fresh.env.state.props.SETUP_CODE;
      const sheetText = JSON.stringify(fresh.env.SpreadsheetApp.openById(fresh.env.state.props.SPREADSHEET_ID).getSheetByName('เริ่มต้นใช้งาน').rows);
      assert.ok(sheetText.includes(code));
      assert.ok(!(await page.content()).includes(code));
      await page.fill('#suCode', 'WRONG-CODE-0000');
      await page.fill('#suName', 'นายผู้ดูแล คนแรก');
      await page.fill('#suUser', 'first.admin');
      await page.fill('#suPw', 'FirstAdm1n2026');
      await page.fill('#suPw2', 'FirstAdm1n2026');
      await page.click('#setupBtn');
      await page.waitForSelector('[data-field="setupCode"].has-error');
      await page.fill('#suCode', code);
      await page.click('#suMyLoc');
      await page.waitForFunction(() => document.querySelector('#suLat').value !== '');
      await page.fill('#suStart', '07:30');
      await page.fill('#suLate', '08:00');
      await page.check('#suConfirm');
      await page.click('#setupBtn');
      await page.waitForSelector('#view-app:not([hidden])', { timeout: 15000 });
      assert.ok(await page.isVisible('#toAdminBtn'));
      await page.waitForFunction(() => /07:30–16:30/.test(document.querySelector('#workHours').textContent));
      assert.ok(await page.isEnabled('#checkInBtn'), 'geofence configured from wizard');
      assert.ok(!('SETUP_CODE' in fresh.env.state.props));
      await page.click('#toAdminBtn');
      await page.waitForSelector('#view-admin:not([hidden]) #ovStats .stat-card');
      assert.strictEqual(await page.locator('#ovWarnings .alert').count(), 0);
      // รายการตั้งค่าเริ่มต้น: พิกัดและเวลาทำงานทำในหน้าติดตั้งแล้ว (2/6)
      const setupTxt = await page.textContent('#setupCard');
      assert.ok(/ตั้งค่าเริ่มต้นให้ครบ \(2\/6\)/.test(setupTxt) && /เพิ่มวันปิดภาคเรียน/.test(setupTxt) && /เพิ่มครูและบุคลากร/.test(setupTxt), setupTxt);
      await page.locator('#setupCard').scrollIntoViewIfNeeded();
      await shot(page, '24-setup-checklist-mobile.png');
      await page.locator('#setupCard .setup-item', { hasText: 'เพิ่มวันปิดภาคเรียน' }).locator('[data-go-sec]').click();
      await page.waitForSelector('[data-panel-sec="calendar"]:not([hidden])');
    } finally { fresh.server.close(); }
  });

  await step('E24', 'ลืมรหัสผ่าน: ครูส่งคำขอจากหน้าเข้าสู่ระบบ → Admin เห็นคำขอ → รีเซ็ต → ครูเข้าด้วยรหัสชั่วคราวและตั้งรหัสใหม่', async () => {
    const p = await newPage();
    await p.fill('#loginUsername', 'somsri.j');
    await p.click('#forgotBtn');
    assert.strictEqual(await p.inputValue('#fpIdent'), 'somsri.j');
    await p.fill('#fpNote', 'อยู่ห้องพักครู ป.4');
    await modalAction(p, 'ส่งคำขอ');
    await p.waitForSelector('#fpDone:not([hidden])');
    assert.ok(/ส่งคำขอแล้ว/.test(await p.textContent('#fpDoneText')));
    await modalAction(p, 'เสร็จสิ้น');
    await admin.click('#adminNav [data-sec="overview"]');
    await admin.locator('#ovTasks .task-chip', { hasText: 'ขอรีเซ็ตรหัสผ่าน' }).waitFor();
    await admin.click('#adminNav [data-sec="members"]');
    await admin.locator('#memResetRequests', { hasText: 'อยู่ห้องพักครู ป.4' }).waitFor();
    await admin.click('#memResetRequests [data-reset-req]');
    await modalAction(admin, 'รีเซ็ตรหัสผ่าน');
    await admin.waitForSelector('.modal .temp-pass');
    const temp = (await admin.textContent('.modal .temp-pass')).trim();
    await modalAction(admin, 'บันทึกแล้ว');
    await admin.waitForFunction(() => document.querySelector('#memResetRequests').textContent.trim() === '');
    await login(p, 'somsri.j', temp);
    await p.waitForSelector('#view-force-password:not([hidden])');
    await p.fill('#fpCurrent', temp);
    await p.fill('#fpNew', 'SomsriNew2026');
    await p.fill('#fpConfirm', 'SomsriNew2026');
    await p.click('#forcePwForm button[type=submit]');
    await p.waitForSelector('#view-app:not([hidden])');
  });

  let easy;
  await step('E25', 'จำการเข้าสู่ระบบบนโทรศัพท์: เปิดแอปครั้งต่อไปเข้าได้ทันที, เซสชันหมดอายุก็เข้าใหม่ให้เอง, กดออกจากระบบแล้วเลิกจำ', async () => {
    easy = await newPage();
    assert.ok(await easy.isChecked('#rememberMe'), 'โทรศัพท์: เลือก "จำการเข้าสู่ระบบ" ไว้ให้');
    await login(easy, 'somsri.j', 'SomsriNew2026');
    await easy.waitForSelector('#view-app:not([hidden])');
    assert.ok(await easy.evaluate(() => /^[a-f0-9]{16}\.[a-f0-9]{64}$/.test(localStorage.getItem('wsh_device') || '')));
    // ปิดแอปแล้วเปิดใหม่ (sessionStorage หาย) → เข้าใช้งานได้เลย ไม่ต้องใส่รหัสผ่าน
    await easy.evaluate(() => sessionStorage.clear());
    await easy.reload();
    await easy.waitForSelector('#view-app:not([hidden])', { timeout: 15000 });
    assert.ok(!(await easy.isVisible('#view-login')));
    // Session ฝั่ง Server หมดอายุ (12 ชม.) → กดเมนูต่อได้ ระบบเข้าสู่ระบบใหม่ให้เงียบ ๆ
    app.env.clock.fixed = app.env.clock.now() + 13 * 3600e3;
    await easy.click('#userTabs [data-tab="history"]');
    await easy.waitForSelector('#histTable table, #histTable .empty-state');
    assert.ok(await easy.isVisible('#view-app'));
    await easy.click('#userTabs [data-tab="account"]');
    assert.ok(/จำการเข้าสู่ระบบไว้แล้ว/.test(await easy.textContent('#accDeviceText')));
    assert.ok(await easy.isHidden('#accRememberBtn'));
  });

  await step('E26', 'สถิติการลาตามปีงบประมาณ + พิมพ์ใบลาแบบราชการ (A4 หน้าเดียว)', async () => {
    await easy.click('#userTabs [data-tab="leave"]');
    await easy.waitForSelector('#lvStats table');
    const stats = await easy.textContent('#lvStats');
    ['รอบที่ 1', 'รอบที่ 2', 'ลาป่วย', 'ลากิจ', 'มาสาย', 'ต.ค. – มี.ค.'].forEach(t => assert.ok(stats.includes(t), t));
    assert.strictEqual(await easy.inputValue('#lvStatsFy'), '2570');
    await easy.evaluate(() => { const o = window.print; window.print = () => { window.__printHtml = document.getElementById('printArea').innerHTML; window.__pageCss = (document.getElementById('printPageStyle') || {}).textContent; o(); }; });
    await easy.locator('#myLeaves [data-print-leave]').first().click();
    await easy.waitForFunction(() => !!window.__printHtml);
    const html = await easy.evaluate(() => window.__printHtml);
    ['แบบใบลาป่วย ลาคลอดบุตร ลากิจส่วนตัว', 'เขียนที่', 'เรียน', 'ผู้อำนวยการโรงเรียนวัดเสาหิน', 'นางสาวสมศรี ใจดี', 'สถิติการลาในปีงบประมาณ 2570',
      'ลามาแล้ว', 'ความเห็นผู้บังคับบัญชา', 'อนุญาต', 'ผู้ตรวจสอบ'].forEach(t => assert.ok(html.includes(t), t));
    assert.ok(/A4 portrait/.test(await easy.evaluate(() => window.__pageCss)), 'ใบลาพิมพ์แนวตั้ง');
    // เรนเดอร์เป็น PDF ด้วย CSS จริงของระบบ: ต้องได้ 1 หน้า A4
    const css = await easy.evaluate(() => Array.from(document.querySelectorAll('style')).map(x => x.textContent).join('\n'));
    const pg = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    await pg.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style><style>@page { size: A4 portrait; margin: 14mm 16mm; }</style></head>' +
      '<body class="printing"><div id="printArea" class="print-area">' + html + '</div></body></html>');
    await pg.emulateMedia({ media: 'print' });
    const pdf = await pg.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.strictEqual(pages, 1, 'ใบลาต้องพิมพ์ได้ในหน้าเดียว (ได้ ' + pages + ' หน้า)');
    await pg.evaluate(() => { document.body.style.padding = '40px 52px'; });
    fs.mkdirSync(SHOTS, { recursive: true });
    await pg.screenshot({ path: path.join(SHOTS, '14-leave-form-print.png'), fullPage: true });
    await pg.close();
    await easy.evaluate(() => window.scrollTo(0, 0));
    await easy.locator('#lvStatsCard').scrollIntoViewIfNeeded();
    await shot(easy, '15-leave-stats-mobile.png');
  });

  await step('E27', 'ใช้งานง่าย: ปุ่มลัด "แจ้งลา" บนหน้าแรก, ปรับตัวอักษรใหญ่ (จอไม่ล้น), แนะนำเพิ่มไอคอนบนหน้าจอ, ออกจากระบบแล้วเครื่องเลิกจำ', async () => {
    await easy.click('#userTabs [data-tab="home"]');
    await easy.click('.quick-links [data-tab-go="leave"]');
    await easy.waitForSelector('[data-panel="leave"]:not([hidden])');
    await easy.click('#userTabs [data-tab="account"]');
    await easy.click('#fontSizeSeg [data-val="1.25"]');
    assert.strictEqual(await easy.evaluate(() => document.documentElement.style.fontSize), '125%');
    assert.strictEqual(await easy.evaluate(() => localStorage.getItem('wsh_font')), '1.25');
    await easy.click('#userTabs [data-tab="home"]');
    await easy.waitForFunction(() => document.querySelector('#homeName').textContent.length > 1);
    assert.ok(await easy.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'ตัวอักษรใหญ่แล้วหน้าจอไม่ล้นแนวนอน');
    await easy.evaluate(() => window.scrollTo(0, 0));
    await shot(easy, '16-large-text-mobile.png');
    assert.ok(await easy.isVisible('#homeTip'));
    await easy.click('#homeTipBtn');
    await easy.locator('.modal', { hasText: 'เพิ่มไอคอนไว้บนหน้าจอ' }).waitFor();
    assert.ok(/เพิ่มลงในหน้าจอหลัก/.test(await easy.textContent('.modal .howto')));
    await modalAction(easy, 'เข้าใจแล้ว');
    await easy.waitForSelector('#homeTip', { state: 'hidden' });
    await easy.click('#userTabs [data-tab="account"]');
    await easy.click('#fontSizeSeg [data-val="1"]');
    await easy.click('#logoutBtn2');
    await modalAction(easy, 'ออกจากระบบ');
    await easy.waitForSelector('#view-login:not([hidden])');
    assert.strictEqual(await easy.evaluate(() => localStorage.getItem('wsh_device')), null);
    await easy.reload();
    await easy.waitForSelector('#view-login:not([hidden])');
    assert.strictEqual(await easy.inputValue('#loginUsername'), 'somsri.j'); // จำชื่อผู้ใช้ไว้ให้
  });

  await step('E28', 'ผู้บริหาร: บัญชีสรุปวันลา/มาสาย/ขาดงาน รายรอบการประเมิน (Export ได้) + ตั้งชื่อผู้อำนวยการ; คอมพิวเตอร์ไม่จำการเข้าสู่ระบบโดยอัตโนมัติ', async () => {
    const d = await newPage({ desktop: true });
    assert.ok(!(await d.isChecked('#rememberMe')), 'คอมพิวเตอร์: ไม่เลือกจำการเข้าสู่ระบบไว้ก่อน');
    await login(d, DEFAULTS.adminUser, ADMIN_NEW_PW);
    await d.waitForSelector('#view-app:not([hidden])');
    assert.strictEqual(await d.evaluate(() => localStorage.getItem('wsh_device')), null);
    await d.click('#toAdminBtn');
    await d.waitForSelector('#view-admin:not([hidden])');
    await d.click('#adminNav [data-sec="settings"]');
    await d.waitForFunction(() => document.querySelector('#sRemember').value === '30');
    await d.fill('#sDirName', 'นายสมชาย ใจดี');
    await d.fill('#sAffil', 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาเชียงใหม่ เขต 1');
    await d.click('#setForm button[type=submit]');
    await toast(d, /บันทึกการตั้งค่าแล้ว/);
    await d.click('#adminNav [data-sec="reports"]');
    await d.click('#repTypeSeg [data-val="leaveSummary"]');
    assert.ok(await d.isVisible('#repFy') && await d.isVisible('#repRound'));
    assert.strictEqual(await d.inputValue('#repFy'), '2570');
    await d.click('#repRunBtn');
    await d.locator('#repResult .report-head', { hasText: 'บัญชีสรุปวันลา มาสาย และขาดงาน' }).waitFor();
    const txt = await d.textContent('#repResult');
    ['รอบที่ 1 ปีงบประมาณ 2570', 'ป่วย+กิจ (ครั้ง)', 'มาสาย (ครั้ง)', 'นางสาวสมศรี ใจดี', 'ไม่ลา ไม่สาย ไม่ขาด'].forEach(t => assert.ok(txt.includes(t), t));
    const [dl] = await Promise.all([d.waitForEvent('download'), d.click('[data-export="xlsx"]')]);
    assert.strictEqual(dl.suggestedFilename(), 'WatSaoHin_Attendance_LeaveSummary_FY2570_R1.xlsx');
    await d.evaluate(() => { const o = window.print; window.print = () => { window.__printHtml = document.getElementById('printArea').innerHTML; o(); }; });
    await d.click('#repPrintBtn');
    await d.waitForFunction(() => !!window.__printHtml);
    assert.ok((await d.evaluate(() => window.__printHtml)).includes('นายสมชาย ใจดี'), 'ชื่อผู้อำนวยการในช่องลงนาม');
    await d.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); document.querySelector('#repExportBar').scrollIntoView(); });
    await shot(d, '17-leave-summary-desktop.png');
  });

  let adm, slips;
  await step('E29', 'แชร์ระบบ: QR Code เข้าใช้งาน (ถอดรหัสได้ลิงก์ระบบ), ข้อความสำหรับกลุ่ม LINE, พิมพ์ประกาศ QR ขนาด A4 หน้าเดียว', async () => {
    await setClock('2026-11-17 07:00:00');
    adm = await newPage({ desktop: true });
    await login(adm, DEFAULTS.adminUser, ADMIN_NEW_PW);
    await adm.waitForSelector('#view-app:not([hidden])');
    await adm.click('#toAdminBtn');
    await adm.waitForSelector('#view-admin:not([hidden])');
    await adm.click('#adminNav [data-sec="share"]');
    await adm.waitForSelector('#shareQr svg');
    const url = await adm.inputValue('#shareUrl');
    assert.ok(/^https:\/\/script\.google\.com\/macros\/s\/\S+\/exec$/.test(url), url);
    const modules = await adm.evaluate(u => window.WshQR.encode(u).modules, url);
    assert.strictEqual(decodeQR(modules).text, url, 'QR Code ในหน้าเว็บถอดรหัสได้ลิงก์ระบบ');
    const msg = await adm.inputValue('#shareMsg');
    ['ระบบลงเวลาปฏิบัติงานออนไลน์ โรงเรียนวัดเสาหิน', url, 'จำการเข้าสู่ระบบบนเครื่องนี้', 'ลืมรหัสผ่าน'].forEach(t => assert.ok(msg.includes(t), t));
    await adm.click('#shareMsgCopyBtn');
    await toast(adm, /คัดลอก/);
    await adm.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await shot(adm, '18-share-qr-desktop.png');
    await capturePrint(adm);
    await adm.click('#sharePosterBtn');
    await adm.waitForFunction(() => !!window.__printHtml);
    const html = await adm.evaluate(() => window.__printHtml);
    ['สแกน QR Code ด้วยกล้องโทรศัพท์', 'จำการเข้าสู่ระบบบนเครื่องนี้', '<svg'].forEach(t => assert.ok(html.includes(t), t));
    assert.strictEqual(await printPreview(adm, html, 'portrait', '19-qr-poster-print.png'), 1, 'ประกาศ QR ต้องพิมพ์ได้ในหน้าเดียว');
    // ลิงก์ /dev → เตือน
    await adm.fill('#shareUrl', url.replace(/\/exec$/, '/dev'));
    await adm.waitForSelector('#shareUrlWarn:not([hidden])');
    await adm.fill('#shareUrl', url);
    await adm.waitForSelector('#shareUrlWarn', { state: 'hidden' });
  });

  await step('E30', 'เพิ่มบุคลากรหลายคน: วางรายชื่อจาก Excel → ตรวจทุกแถว (แถวผิดสร้างไม่ได้) → สร้างบัญชี → พิมพ์บัตรเข้าใช้งานพร้อม QR Code', async () => {
    await adm.click('#adminNav [data-sec="members"]');
    await adm.click('#memBulkBtn');
    await adm.waitForSelector('#bkText');
    // วางจาก Excel: มีคอลัมน์ลำดับ 1,2,3 และไม่มีรหัสบุคลากร (ระบบกำหนดให้)
    await adm.fill('#bkText', 'ลำดับ\tชื่อ\tนามสกุล\tตำแหน่ง\n1\tนางสาวมาลี\tศรีสุข\tครูชำนาญการ\n2\tนายสมปอง\tรักดี\tครูผู้ช่วย\n3\tชื่อเดียว\t\tธุรการ');
    await adm.waitForFunction(() => document.querySelectorAll('#bkPreview tbody tr').length === 3);
    assert.ok(await adm.locator('#bkPreview tr.row-error').count() === 1);
    assert.ok(await adm.isDisabled('.modal-actions .btn.success'), 'มีแถวผิด → กดสร้างไม่ได้');
    assert.ok(/อัตโนมัติ/.test(await adm.textContent('#bkPreview')), 'ไม่มีรหัส → ระบบกำหนดให้');
    await adm.fill('#bkText', 'นางสาวมาลี\tศรีสุข\tครูชำนาญการ\nนายสมปอง\tรักดี\tครูผู้ช่วย\nนางสาวใจดี\tมีสุข\tธุรการ');
    await adm.waitForFunction(() => document.querySelectorAll('#bkPreview tbody tr').length === 3 && !document.querySelector('#bkPreview tr.row-error'));
    assert.ok(/สร้างบัญชี 3 คน/.test(await adm.textContent('.modal-actions .btn.success')));
    await adm.click('.modal-actions .btn.success');
    await adm.locator('.modal', { hasText: 'สร้างบัญชีแล้ว 3 คน' }).waitFor();
    slips = await adm.$$eval('#bkResult tbody tr', trs => trs.map(tr => Array.from(tr.cells).map(c => c.textContent.trim())));
    assert.ok(slips.every(r => /^t\d{3}$/.test(r[1])), 'ชื่อผู้ใช้สร้างจากรหัสที่ระบบกำหนด: ' + slips.map(r => r[1]));
    assert.strictEqual(new Set(slips.map(r => r[1])).size, 3);
    assert.ok(slips.every(r => /^[A-Za-z2-9]{12}$/.test(r[2])), 'รหัสผ่านชั่วคราว 12 ตัว');
    await capturePrint(adm);
    await adm.locator('.modal-actions .btn', { hasText: 'พิมพ์บัตรเข้าใช้งาน' }).click();
    await adm.waitForFunction(() => !!window.__printHtml);
    const html = await adm.evaluate(() => window.__printHtml);
    assert.strictEqual((html.match(/class="slip"/g) || []).length, 3);
    slips.forEach(r => assert.ok(html.includes(r[1]) && html.includes(r[2]), r[1]));
    assert.strictEqual((html.match(/<svg/g) || []).length, 3, 'บัตรทุกใบมี QR Code');
    assert.strictEqual(await printPreview(adm, html, 'portrait', '20-login-slips-print.png'), 1);
    await modalAction(adm, 'เสร็จสิ้น');
    await adm.locator('#memTable tr', { hasText: 'นางสาวมาลี ศรีสุข' }).waitFor();
  });

  await step('E31', 'ครูใช้บัตรเข้าใช้งาน → ตั้งรหัสใหม่ → ลงเวลา; วันต่อมาหน้าแรกเตือน "ลงเวลาไม่ครบ" → แตะแก้ไข/แจ้งลา (กรอกวันที่ให้) → รายการหายไป', async () => {
    const tp = await newPage();
    await setClock('2026-11-17 07:30:00');
    await login(tp, slips[0][1], slips[0][2]);
    await tp.waitForSelector('#view-force-password:not([hidden])');
    await tp.fill('#fpCurrent', slips[0][2]);
    await tp.fill('#fpNew', 'Malee2026new'); await tp.fill('#fpConfirm', 'Malee2026new');
    await tp.click('#forcePwForm button[type=submit]');
    await tp.waitForSelector('#view-app:not([hidden])');
    assert.ok(await tp.isHidden('#issuesCard'));
    await tp.click('#checkInBtn');
    await tp.waitForSelector('.modal .result-hero.ok', { timeout: 15000 });
    await tp.keyboard.press('Escape');
    await tp.evaluate(() => { document.getElementById('modalHost').innerHTML = ''; });
    // สองวันต่อมา: ลืมลงเวลาออกวันที่ 17 และไม่ได้มาวันที่ 18
    await setClock('2026-11-19 09:00:00');
    await tp.evaluate(() => sessionStorage.clear());
    await tp.reload();
    await tp.waitForSelector('#issuesCard:not([hidden])', { timeout: 15000 });
    assert.strictEqual(await tp.textContent('#issuesCount'), '2 วัน');
    const txt = await tp.textContent('#issuesList');
    assert.ok(/18 พ\.ย\. 69/.test(txt) && /ไม่มีการลงเวลา/.test(txt) && /17 พ\.ย\. 69/.test(txt) && /ไม่ได้ลงเวลาออก/.test(txt), txt);
    await tp.locator('#issuesCard').scrollIntoViewIfNeeded();
    await shot(tp, '21-issues-mobile.png');
    await tp.click('[data-issue-fix="2026-11-17"]');
    await tp.waitForSelector('[data-panel="correction"]:not([hidden])');
    assert.strictEqual(await tp.inputValue('#corrDate'), '2026-11-17');
    assert.ok(await tp.isChecked('#corrForm input[name=type][value="OUT"]'));
    await tp.fill('#corrTime', '16:40');
    await tp.fill('#corrReason', 'ลืมกดลงเวลาออก');
    await tp.click('#corrForm button[type=submit]');
    await toast(tp, /ส่งคำร้อง/);
    await tp.click('#userTabs [data-tab="home"]');
    await tp.waitForFunction(() => document.querySelector('#issuesCount').textContent === '1 วัน');
    await tp.click('[data-issue-leave="2026-11-18"]');
    await tp.waitForSelector('[data-panel="leave"]:not([hidden])');
    assert.strictEqual(await tp.inputValue('#leaveStart'), '2026-11-18');
    await tp.click('#leaveTypeGrid [data-type="PERSONAL"]');
    await modalAction(tp, 'ยืนยันการลา');
    await toast(tp, /ใบลา|การลา/);
    await tp.click('#userTabs [data-tab="home"]');
    await tp.waitForSelector('#issuesCard', { state: 'hidden' });
  });

  await step('E32', 'ครูลืมลงเวลาเข้าตอนเช้า: กดลงเวลาหลังเวลาสาย → ถาม "ลืมกด?" → แจ้งเวลาที่มาถึงจริง → ตอนเย็นลงเวลาออกได้ตามปกติ', async () => {
    await setClock('2026-11-20 10:15:00');
    const tp = await newPage();
    await login(tp, slips[0][1], 'Malee2026new');
    await tp.waitForSelector('#view-app:not([hidden])');
    await tp.waitForFunction(() => document.querySelector('#clockTime').textContent !== '--:--:--');
    assert.ok(await tp.isDisabled('#checkOutBtn'));
    await tp.click('#checkInBtn');
    await tp.locator('.modal', { hasText: 'มาถึงตอนนี้ หรือลืมกด?' }).waitFor();
    await shot(tp, '22-forgot-checkin-mobile.png');
    await modalAction(tp, 'ลืมกด — แจ้งเวลาที่มาถึงจริง');
    await tp.waitForSelector('[data-panel="correction"]:not([hidden])');
    assert.strictEqual(await tp.inputValue('#corrDate'), '2026-11-20');
    assert.ok(await tp.isChecked('#corrForm input[name=type][value="IN"]'));
    await tp.fill('#corrTime', '07:40');
    await tp.fill('#corrReason', 'มาถึงแล้วลืมกดลงเวลา');
    await tp.click('#corrForm button[type=submit]');
    await toast(tp, /ส่งคำร้อง/);
    await tp.click('#userTabs [data-tab="home"]');
    await tp.waitForFunction(() => /รออนุมัติ/.test(document.querySelector('#checkInSub').textContent));
    assert.ok(await tp.isDisabled('#checkInBtn'));
    assert.ok(await tp.isEnabled('#checkOutBtn'), 'ลงเวลาออกได้ระหว่างรออนุมัติเวลาเข้า');
    await setClock('2026-11-20 16:45:00');
    await tp.click('#checkOutBtn');
    await modalAction(tp, 'ลงเวลาออก');
    await tp.waitForSelector('.modal .result-hero.ok', { timeout: 15000 });
    assert.ok(/ลงเวลาออกงานสำเร็จ/.test(await tp.textContent('.modal')));
  });

  await step('E33', 'ผู้บริหาร: ครูโทรแจ้งว่าลืมลงเวลา → กด "บันทึกเวลาแทน" จากตารางวันนี้ (เลือกคน/วัน/ประเภทให้แล้ว) → มีผลทันที', async () => {
    await setClock('2026-11-20 16:50:00');
    const d = await newPage({ desktop: true });
    await login(d, DEFAULTS.adminUser, ADMIN_NEW_PW);
    await d.waitForSelector('#view-app:not([hidden])');
    await d.click('#toAdminBtn');
    await d.waitForSelector('#ovTable table');
    const row = d.locator('#ovTable tr', { hasText: 'นายสมปอง รักดี' });
    await row.locator('[data-rec-time]').click();
    await d.locator('.modal', { hasText: 'บันทึกเวลาแทน' }).waitFor();
    assert.strictEqual(await d.inputValue('#rtDate'), '2026-11-20');
    assert.ok(/สมปอง/.test(await d.$eval('#rtEmp', s => s.options[s.selectedIndex].text)));
    assert.strictEqual(await d.getAttribute('#rtType .active', 'data-val'), 'IN');
    await d.fill('#rtTime', '07:35');
    await shot(d, '23-record-time-desktop.png');
    await modalAction(d, 'บันทึกเวลา');
    await toast(d, /บันทึกเวลาเข้างานของ นายสมปอง รักดี/);
    await d.locator('#ovTable tr', { hasText: 'นายสมปอง รักดี' }).locator('td', { hasText: '07:35' }).waitFor();
    // ครูมาลี (t201) มีคำร้องเวลาเข้ารออนุมัติ → อนุมัติแล้ววันนั้นครบ
    await d.click('#adminNav [data-sec="corrections"]');
    await d.locator('#crList .req-card', { hasText: 'นางสาวมาลี ศรีสุข' }).filter({ hasText: '20 พฤศจิกายน 2569' }).locator('[data-cr="APPROVE"]').click();
    await modalAction(d, 'อนุมัติ');
    await toast(d, /อนุมัติคำร้อง/);
  });

  await step('E34', 'ผู้บริหารเปิดแอป: หน้าแรกแจ้ง "งานรออนุมัติ" → แตะ "ไปอนุมัติ" เข้าหน้าใบลาทันที → "อนุมัติทั้งหมด" ในครั้งเดียว', async () => {
    await setClock('2026-11-23 07:20:00');
    const tp = await newPage();
    await login(tp, 'somsri.j', 'SomsriNew2026');
    await tp.waitForSelector('#view-app:not([hidden])');
    for (const d of ['2026-11-25', '2026-11-26']) {
      await tp.click('#userTabs [data-tab="leave"]');
      await tp.click('#lvQuickDay [data-val="custom"]');
      await tp.fill('#leaveStart', d); await tp.dispatchEvent('#leaveStart', 'change');
      await tp.click('#leaveTypeGrid [data-type="PERSONAL"]');
      await modalAction(tp, 'ยืนยันการลา');
      await toast(tp, /ส่งใบลา/);
      await tp.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    }
    const boss = await newPage();
    await login(boss, DEFAULTS.adminUser, ADMIN_NEW_PW);
    await boss.waitForSelector('#approvalsCard:not([hidden])');
    assert.ok(/ใบลา \d+/.test(await boss.textContent('#apDetail')), await boss.textContent('#apDetail'));
    await shot(boss, '25-approvals-home-mobile.png');
    await boss.click('#apGoBtn');
    await boss.waitForSelector('[data-panel-sec="leaves"]:not([hidden]) #lvList .req-card');
    await boss.waitForSelector('#lvApproveAllBtn:not([hidden])');
    const n = +(/\((\d+)\)/.exec(await boss.textContent('#lvApproveAllBtn'))[1]);
    assert.ok(n >= 2, 'อนุมัติทั้งหมด ' + n);
    await boss.click('#lvApproveAllBtn');
    await modalAction(boss, 'อนุมัติ ' + n + ' รายการ');
    await toast(boss, new RegExp('อนุมัติแล้ว ' + n + ' รายการ'));
    await boss.waitForFunction(() => !document.querySelector('#lvList [data-lv="APPROVE"]'));
    await boss.click('#admBackBtn');
    // ใบลาหายจากแถบ (อาจยังมีงานประเภทอื่น เช่น คำร้องแก้ไขเวลา)
    await boss.waitForFunction(() => document.querySelector('#approvalsCard').hidden || !/ใบลา/.test(document.querySelector('#apDetail').textContent));
  });

  await step('E20', 'ไม่มี JavaScript error ในทุกหน้าที่ทดสอบ', async () => {
    assert.deepStrictEqual(pageErrors, []);
  });

  await browser.close();
  app.server.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  const variant = (process.env.GAS_SRC || 'src') === 'dist' ? '-dist' : '';
  fs.writeFileSync(path.join(__dirname, 'results', 'e2e-results' + variant + '.md'), [
    '# ผลการทดสอบ End-to-End (Chromium + GPS จำลอง)' + (variant ? ' — ชุดติดตั้งแบบง่าย (dist/ 3 ไฟล์)' : ''), '', `รันเมื่อ: ${new Date().toISOString()}  `, `ผลรวม: **${passed}/${results.length} ผ่าน**`, '',
    '| รหัส | รายการทดสอบ | ผล | เวลา (ms) |', '|---|---|---|---|',
    ...results.map(r => `| ${r.id} | ${r.name} | ${r.ok ? '✅ ผ่าน' : '❌ ไม่ผ่าน'} | ${r.ms} |`), ''].join('\n'));
  process.exitCode = passed === results.length ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; try { browser && browser.close(); app && app.server.close(); } catch (x) { /* ignore */ } });
