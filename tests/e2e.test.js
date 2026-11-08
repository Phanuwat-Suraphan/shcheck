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
    await teacher.fill('#regStaffCode', '01001');
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
    assert.strictEqual(rec.StaffCode, '01001'); assert.strictEqual(rec.Status, 'PENDING');
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

  await step('E18', 'ปฏิทินวันหยุด: เพิ่มวันหยุดพิเศษ และแสดงในรายการ', async () => {
    await admin.click('#adminNav [data-sec="calendar"]');
    await admin.fill('#calStart', '2026-12-28');
    await admin.dispatchEvent('#calStart', 'change');
    await admin.fill('#calTitle', 'ปิดภาคเรียน (ทดสอบ)');
    await admin.selectOption('#calType', 'SPECIAL_HOLIDAY');
    await admin.click('#calForm button[type=submit]');
    await toast(admin, /บันทึกปฏิทินแล้ว/);
    await admin.locator('#calList', { hasText: 'ปิดภาคเรียน (ทดสอบ)' }).waitFor();
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
      await page.fill('#suCode2', '0001');
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
    } finally { fresh.server.close(); }
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
