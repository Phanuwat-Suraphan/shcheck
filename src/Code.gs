/**
 * ============================================================================
 *  ระบบลงเวลาปฏิบัติงานออนไลน์ โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่
 *  Wat Sao Hin School Attendance System
 *  "ระบบลงเวลาอัจฉริยะ สะดวก โปร่งใส ตรวจสอบได้"
 * ============================================================================
 *  Code.gs — จุดเริ่มต้นของ Web App, ตัวกระจายคำสั่ง (API Router) และฟังก์ชันกลาง
 *
 *  หลักความปลอดภัยของ Google Apps Script:
 *   - ฟังก์ชันระดับบนสุดที่ "ไม่" ลงท้ายด้วย "_" สามารถถูกเรียกจาก Browser ผ่าน
 *     google.script.run ได้ทั้งหมด
 *   - ระบบนี้จึงเปิดเฉพาะฟังก์ชันสาธารณะที่จำเป็น ได้แก่
 *       doGet, include, getPublicConfig, login, register, firstRunSetup, api
 *       และฟังก์ชันสำหรับผู้พัฒนา (SetupSystem, CreateFirstAdmin, EmergencyResetAdmin,
 *       BenchmarkPasswordHashing, DailyMaintenance) ซึ่งตรวจสอบว่าเรียกจาก
 *       Apps Script Editor โดยเจ้าของโปรเจกต์เท่านั้น
 *   - ทุกคำสั่งที่ต้องเข้าสู่ระบบจะผ่านฟังก์ชัน api() ซึ่งตรวจสอบ Session และสิทธิ์
 *     (Role) ฝั่ง Server ทุกครั้ง ก่อนเรียกฟังก์ชันภายใน (ลงท้ายด้วย "_")
 * ============================================================================
 */

var APP = {
  NAME_TH: 'ระบบลงเวลาปฏิบัติงานออนไลน์',
  SCHOOL_NAME: 'โรงเรียนวัดเสาหิน',
  PROVINCE: 'จังหวัดเชียงใหม่',
  SCHOOL_FULL: 'โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่',
  NAME_EN: 'Wat Sao Hin School Attendance System',
  SLOGAN: 'ระบบลงเวลาอัจฉริยะ สะดวก โปร่งใส ตรวจสอบได้',
  VERSION: '1.0.0',
  TZ: 'Asia/Bangkok'
};

var ROLES = { USER: 'USER', EXECUTIVE: 'EXECUTIVE', ADMIN: 'ADMIN' };
var ROLE_LABELS = { USER: 'บุคลากร', EXECUTIVE: 'ผู้บริหาร', ADMIN: 'ผู้ดูแลระบบ' };

var EMP_STATUS = { PENDING: 'PENDING', ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', REJECTED: 'REJECTED' };
var EMP_STATUS_LABELS = { PENDING: 'รออนุมัติ', ACTIVE: 'ใช้งาน', INACTIVE: 'ปิดใช้งาน', REJECTED: 'ไม่อนุมัติ' };

var POSITIONS = ['ผู้อำนวยการ', 'ครู', 'บุคลากรทางการศึกษา', 'เจ้าหน้าที่อื่น ๆ'];

var LEAVE_TYPES = { SICK: 'ลาป่วย', PERSONAL: 'ลากิจ', VACATION: 'ลาพักผ่อน', OFFICIAL: 'ไปราชการ', OTHER: 'อื่น ๆ' };
var LEAVE_PERIODS = { FULL: 'เต็มวัน', MORNING: 'ครึ่งวันเช้า', AFTERNOON: 'ครึ่งวันบ่าย' };
var REQUEST_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
var REQUEST_STATUS_LABELS = { PENDING: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก' };

var ATT_TYPES = { IN: 'เข้างาน', OUT: 'ออกงาน' };
var ATT_STATUS_LABELS = {
  ON_TIME: 'ตรงเวลา', LATE: 'มาสาย', NORMAL: 'ปกติ', EARLY: 'ออกก่อนเวลา', HOLIDAY: 'วันหยุด'
};
var DAY_STATUS_LABELS = {
  PRESENT: 'มาปฏิบัติงาน', LATE: 'มาสาย', LEAVE: 'ลา', ABSENT: 'ขาดงาน',
  NOT_YET: 'ยังไม่ลงเวลา', HOLIDAY: 'วันหยุด', HOLIDAY_WORK: 'ปฏิบัติงานวันหยุด'
};
var CALENDAR_TYPES = {
  OFFICIAL_HOLIDAY: 'วันหยุดราชการ', SPECIAL_HOLIDAY: 'วันหยุดพิเศษ', SPECIAL_WORKDAY: 'วันทำงานพิเศษ'
};

var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
var THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
var THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/* ========================================================================== */
/*  Web App entry points                                                      */
/* ========================================================================== */

/** เปิดหน้าเว็บแอป */
function doGet(e) {
  resetMemo_();
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.app = {
    nameTh: APP.NAME_TH,
    school: APP.SCHOOL_FULL,
    nameEn: APP.NAME_EN,
    slogan: APP.SLOGAN,
    version: APP.VERSION
  };
  return tpl.evaluate()
    .setTitle(APP.NAME_TH + ' | ' + APP.SCHOOL_FULL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** รวมไฟล์ HTML ย่อยเข้ากับ Template (อนุญาตเฉพาะไฟล์ที่กำหนด) */
function include(filename) {
  var allowed = ['Styles', 'JavaScript', 'Login', 'Register', 'Dashboard'];
  if (allowed.indexOf(filename) < 0) return '';
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    return ''; // ชุดติดตั้งแบบง่ายรวมไฟล์ย่อยไว้ใน Index.html แล้ว
  }
}

/** ข้อมูลสาธารณะสำหรับหน้าเข้าสู่ระบบ/สมัครสมาชิก (ไม่มีข้อมูลลับ) */
function getPublicConfig() {
  resetMemo_();
  try {
    var ready = isSystemReady_();
    var setupError = '';
    if (!ready) {
      // ติดตั้งอัตโนมัติเมื่อเปิดเว็บแอปครั้งแรก (สร้างชีต/ค่าเริ่มต้น/รหัสติดตั้ง) — ไม่ต้องรันโค้ดใน Editor
      try { setupCore_(); } catch (e) { console.error('auto setup failed: ' + (e && e.stack ? e.stack : e)); setupError = String(e && e.message || e); }
      resetMemo_();
      ready = isSystemReady_();
    }
    var needsFirstAdmin = false;
    if (ready && !hasActiveAdmin_()) {
      needsFirstAdmin = true;
      if (!scriptProps_().SETUP_CODE) {
        try { withLock_(function () { if (!scriptProps_().SETUP_CODE) ensureSetupCode_(); }); } catch (e2) { console.error(e2); }
      }
    }
    var s = ready ? getSettings_() : null;
    return {
      ok: true,
      data: {
        appName: APP.NAME_TH,
        school: APP.SCHOOL_FULL,
        nameEn: APP.NAME_EN,
        slogan: APP.SLOGAN,
        version: APP.VERSION,
        setupComplete: ready,
        setupError: setupError ? 'ติดตั้งอัตโนมัติไม่สำเร็จ กรุณาให้เจ้าของระบบเปิด Apps Script แล้วรัน SetupSystem() หนึ่งครั้ง' : '',
        needsFirstAdmin: needsFirstAdmin,
        dbFileName: DB_FILE_NAME_,
        setupSheetName: SETUP_SHEET_,
        allowRegistration: s ? s.allowRegistration : false,
        positions: POSITIONS,
        gpsRetentionDays: s ? s.gpsRetentionDays : 365,
        serverNow: nowMs_()
      }
    };
  } catch (err) {
    return toErrorResponse_(err, 'getPublicConfig');
  }
}

/**
 * จุดเรียกใช้งานเดียวสำหรับคำสั่งที่ต้องเข้าสู่ระบบ
 * @param {string} token Session token
 * @param {string} action ชื่อคำสั่ง เช่น 'att.checkIn'
 * @param {Object} params พารามิเตอร์
 */
function api(token, action, params) {
  resetMemo_();
  try {
    var routes = getRoutes_();
    if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(routes, action)) {
      throw appError_('ไม่พบคำสั่งที่ร้องขอ', 'BAD_REQUEST');
    }
    var route = routes[action];
    var ctx = requireSession_(token, { allowMustChange: !!route.mc });
    if (route.roles && route.roles.indexOf(ctx.user.Role) < 0) {
      writeAudit_(ctx, 'ACCESS_DENIED', 'API', action, { role: ctx.user.Role });
      throw appError_('คุณไม่มีสิทธิ์ใช้งานฟังก์ชันนี้', 'FORBIDDEN');
    }
    var data = route.fn(ctx, sanitizeParams_(params));
    return { ok: true, data: data === undefined ? null : data };
  } catch (err) {
    return toErrorResponse_(err, action);
  }
}

/** ตารางคำสั่ง → ฟังก์ชันภายใน + สิทธิ์ที่ต้องมี (null = ทุกบทบาทที่เข้าสู่ระบบแล้ว) */
function getRoutes_() {
  var A = [ROLES.ADMIN];
  var AE = [ROLES.ADMIN, ROLES.EXECUTIVE];
  return {
    // ----- บัญชีผู้ใช้ -----
    'auth.session': { fn: authSession_, mc: true },
    'auth.ping': { fn: function () { return { alive: true }; }, mc: true },
    'auth.logout': { fn: logout_, mc: true },
    'auth.changePassword': { fn: changePassword_, mc: true },
    // ----- บุคลากร -----
    'me.dashboard': { fn: getMyDashboard_ },
    'me.history': { fn: getMyHistory_ },
    'att.preview': { fn: previewLocation_ },
    'att.checkIn': { fn: function (ctx, p) { return recordAttendance_(ctx, 'IN', p); } },
    'att.checkOut': { fn: function (ctx, p) { return recordAttendance_(ctx, 'OUT', p); } },
    'leave.my': { fn: listMyLeaves_ },
    'leave.submit': { fn: submitLeave_ },
    'leave.cancel': { fn: cancelLeave_ },
    'corr.my': { fn: listMyCorrections_ },
    'corr.submit': { fn: submitCorrection_ },
    'corr.cancel': { fn: cancelCorrection_ },
    'file.get': { fn: getAttachment_ },
    // ----- ผู้บริหาร + ผู้ดูแลระบบ -----
    'admin.view': { fn: getAdminView_, roles: AE },
    'admin.overview': { fn: getAdminOverview_, roles: AE },
    'emp.basicList': { fn: listEmployeesBasic_, roles: AE },
    'leave.adminList': { fn: adminListLeaves_, roles: AE },
    'leave.review': { fn: reviewLeave_, roles: AE },
    'corr.adminList': { fn: adminListCorrections_, roles: AE },
    'corr.review': { fn: reviewCorrection_, roles: AE },
    'report.daily': { fn: reportDaily_, roles: AE },
    'report.monthly': { fn: reportMonthly_, roles: AE },
    'report.yearly': { fn: reportYearly_, roles: AE },
    'report.individual': { fn: reportIndividual_, roles: AE },
    'report.export': { fn: exportReport_, roles: AE },
    'cal.list': { fn: listCalendar_, roles: AE },
    // ----- ผู้ดูแลระบบเท่านั้น -----
    'emp.list': { fn: listEmployees_, roles: A },
    'emp.create': { fn: createEmployee_, roles: A },
    'emp.update': { fn: updateEmployee_, roles: A },
    'emp.setStatus': { fn: setEmployeeStatus_, roles: A },
    'emp.setRole': { fn: setEmployeeRole_, roles: A },
    'emp.approve': { fn: approveRegistration_, roles: A },
    'emp.reject': { fn: rejectRegistration_, roles: A },
    'emp.delete': { fn: deleteEmployee_, roles: A },
    'emp.resetPassword': { fn: resetEmployeePassword_, roles: A },
    'emp.unlock': { fn: unlockEmployee_, roles: A },
    'settings.get': { fn: getSettingsForAdmin_, roles: A },
    'settings.save': { fn: saveSettings_, roles: A },
    'cal.add': { fn: addCalendarEntries_, roles: A },
    'cal.remove': { fn: removeCalendarEntry_, roles: A },
    'cal.addFixed': { fn: addFixedHolidays_, roles: A },
    'audit.list': { fn: listAuditLogs_, roles: A },
    'sys.rebuildSummary': { fn: rebuildDailySummary_, roles: A },
    'sys.runMaintenance': { fn: runMaintenanceNow_, roles: A }
  };
}

/* ========================================================================== */
/*  Error handling                                                            */
/* ========================================================================== */

/** สร้าง Error ที่แสดงข้อความให้ผู้ใช้ได้ (ข้อความภาษาไทย) */
function appError_(message, code, data) {
  var e = new Error(message);
  e.appCode = code || 'ERROR';
  if (data) e.appData = data;
  return e;
}

function toErrorResponse_(err, where) {
  if (err && err.appCode) {
    return { ok: false, error: err.message, code: err.appCode, data: err.appData || null };
  }
  console.error('[' + (where || 'server') + '] ' + (err && err.stack ? err.stack : err));
  return {
    ok: false,
    error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง หากยังพบปัญหาโปรดแจ้งผู้ดูแลระบบ',
    code: 'SERVER_ERROR'
  };
}

/** ทำความสะอาดพารามิเตอร์จาก Browser: ต้องเป็น object ธรรมดา ขนาดไม่เกินกำหนด */
function sanitizeParams_(params) {
  if (params === null || params === undefined) return {};
  if (typeof params !== 'object' || Array.isArray(params)) throw appError_('รูปแบบข้อมูลไม่ถูกต้อง', 'BAD_REQUEST');
  var json = JSON.stringify(params);
  if (json.length > 8 * 1024 * 1024) throw appError_('ข้อมูลที่ส่งมีขนาดใหญ่เกินไป', 'BAD_REQUEST');
  return JSON.parse(json);
}

/**
 * ป้องกันการเรียกฟังก์ชันสำหรับผู้พัฒนาจาก Browser:
 * ต้องรันจาก Apps Script Editor / Trigger โดยเจ้าของโปรเจกต์ (active user = effective user)
 * กรณีผู้ใช้ทั่วไปเปิดเว็บแอป (Execute as: Me) active user จะว่างหรือไม่ตรงกับเจ้าของ
 */
function assertOwnerContext_() {
  var eff = '', act = '';
  try { eff = Session.getEffectiveUser().getEmail() || ''; } catch (e1) { eff = ''; }
  try { act = Session.getActiveUser().getEmail() || ''; } catch (e2) { act = ''; }
  if (!eff || !act || eff.toLowerCase() !== act.toLowerCase()) {
    throw new Error('ฟังก์ชันนี้ต้องรันจาก Apps Script Editor โดยเจ้าของโปรเจกต์เท่านั้น');
  }
}

/* ========================================================================== */
/*  Locking                                                                   */
/* ========================================================================== */

/**
 * รันฟังก์ชันภายใต้ Script Lock (ป้องกันการบันทึกซ้ำ/ชนกันเมื่อมีผู้ใช้พร้อมกัน)
 * - flush ข้อมูลลง Sheets ก่อนปล่อย Lock
 * - อัปเดตเวอร์ชันแคชของตารางที่ถูกแก้ไขหลัง flush
 */
function withLock_(fn, timeoutMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 25000)) {
    throw appError_('ขณะนี้มีผู้ใช้งานพร้อมกันจำนวนมาก กรุณาลองใหม่อีกครั้งในไม่กี่วินาที', 'BUSY');
  }
  try {
    var result = fn();
    SpreadsheetApp.flush();
    commitDirtyTables_();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/*  Date / time helpers (เวลา Asia/Bangkok จาก Server เท่านั้น)               */
/* ========================================================================== */

function now_() { return new Date(); }
function nowMs_() { return now_().getTime(); }
function fmt_(date, pattern) { return Utilities.formatDate(date, APP.TZ, pattern); }
function todayStr_() { return fmt_(now_(), 'yyyy-MM-dd'); }
function nowTimeStr_() { return fmt_(now_(), 'HH:mm:ss'); }
function nowStamp_() { return fmt_(now_(), 'yyyy-MM-dd HH:mm:ss'); }

/** ตรวจสอบ/แยกสตริง yyyy-MM-dd → {y, m, d} หรือ null */
function parseYmd_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2200 || mo < 1 || mo > 12 || d < 1) return null;
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y: y, m: mo, d: d };
}

function isValidYmd_(s) { return !!parseYmd_(s); }

function ymdToUtcMs_(s) {
  var p = parseYmd_(s);
  return Date.UTC(p.y, p.m - 1, p.d);
}

function utcMsToYmd_(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

function addDays_(s, n) { return utcMsToYmd_(ymdToUtcMs_(s) + n * 86400000); }
function dayOfWeek_(s) { return new Date(ymdToUtcMs_(s)).getUTCDay(); }
function daysBetween_(a, b) { return Math.round((ymdToUtcMs_(b) - ymdToUtcMs_(a)) / 86400000); }
function daysInMonth_(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function monthStart_(y, m) { return y + '-' + pad2_(m) + '-01'; }
function monthEnd_(y, m) { return y + '-' + pad2_(m) + '-' + pad2_(daysInMonth_(y, m)); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** รายการวันที่จาก a ถึง b (รวมปลายทั้งสองด้าน) */
function dateList_(a, b) {
  var out = [];
  var n = daysBetween_(a, b);
  for (var i = 0; i <= n; i++) out.push(addDays_(a, i));
  return out;
}

function isValidTime_(s) { return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(s || '')); }

/** 'HH:mm' หรือ 'HH:mm:ss' → นาที (ทศนิยมสำหรับวินาที) */
function timeToMin_(s) {
  var p = String(s || '').split(':');
  return (+p[0]) * 60 + (+p[1] || 0) + (+p[2] || 0) / 60;
}

function normTime_(s) {
  s = String(s || '');
  return s.length === 5 ? s + ':00' : s;
}

function minToHHMM_(min) {
  if (min === null || min === undefined || !isFinite(min)) return '';
  min = Math.round(min);
  return pad2_(Math.floor(min / 60) % 24) + ':' + pad2_(min % 60);
}

/** วันที่ภาษาไทย (พ.ศ.) */
function thaiDate_(ymd, style) {
  var p = parseYmd_(ymd);
  if (!p) return String(ymd || '');
  var be = p.y + 543;
  if (style === 'short') return p.d + ' ' + THAI_MONTHS_SHORT[p.m - 1] + ' ' + String(be).slice(-2);
  if (style === 'long') {
    return 'วัน' + THAI_DAYS[dayOfWeek_(ymd)] + 'ที่ ' + p.d + ' ' + THAI_MONTHS[p.m - 1] + ' พ.ศ. ' + be;
  }
  return p.d + ' ' + THAI_MONTHS[p.m - 1] + ' ' + be;
}

function thaiMonthYear_(y, m) { return THAI_MONTHS[m - 1] + ' ' + (y + 543); }

/** 'yyyy-MM-dd HH:mm:ss' → '8 พ.ย. 69 08:15 น.' */
function thaiStamp_(stamp) {
  if (!stamp) return '';
  var parts = String(stamp).split(' ');
  return thaiDate_(parts[0], 'short') + (parts[1] ? ' ' + parts[1].substr(0, 5) + ' น.' : '');
}

/* ========================================================================== */
/*  Misc helpers                                                              */
/* ========================================================================== */

/** สร้างรหัสอ้างอิง เช่น ATT-261108-9F3A2B1C0D */
function newId_(prefix) {
  return prefix + '-' + fmt_(now_(), 'yyMMdd') + '-' +
    Utilities.getUuid().replace(/-/g, '').substr(0, 10).toUpperCase();
}

/** ลบอักขระควบคุมและช่องว่างหัวท้าย (ข้อความหลายบรรทัด) */
function cleanText_(v, maxLen) {
  var s = String(v === null || v === undefined ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  return maxLen ? s.substr(0, maxLen) : s;
}

/** ข้อความบรรทัดเดียว */
function cleanLine_(v, maxLen) {
  return cleanText_(v, maxLen).replace(/\s+/g, ' ');
}

function toNumber_(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
  return NaN;
}

function round_(n, digits) {
  var f = Math.pow(10, digits || 0);
  return Math.round(n * f) / f;
}

/** ตัด field ลับออกจากข้อมูลบุคลากร */
function publicUser_(emp) {
  return {
    employeeId: emp.EmployeeID,
    staffCode: emp.StaffCode,
    fullName: emp.FullName,
    position: emp.Position,
    username: emp.Username,
    role: emp.Role,
    roleLabel: ROLE_LABELS[emp.Role] || emp.Role,
    status: emp.Status,
    mustChangePassword: !!emp.MustChangePassword
  };
}

/** ลิงก์แผนที่แบบธรรมดา (ไม่ใช้ API ที่เสียเงิน) */
function mapLinks_(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng) || lat === null || lng === null || lat === '' || lng === '') return null;
  var la = round_(Number(lat), 6), lo = round_(Number(lng), 6);
  return {
    osm: 'https://www.openstreetmap.org/?mlat=' + la + '&mlon=' + lo + '#map=18/' + la + '/' + lo,
    google: 'https://www.google.com/maps?q=' + la + ',' + lo
  };
}
