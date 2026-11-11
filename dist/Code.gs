/*
 * ระบบลงเวลาปฏิบัติงานออนไลน์ โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่ — v1.10.0
 * ชุดติดตั้งแบบง่าย: ไฟล์ Code.gs (โค้ดฝั่ง Server ทั้งหมด)
 * ไฟล์นี้สร้างอัตโนมัติจากโฟลเดอร์ src/ ด้วย tools/build-bundle.js — แก้ไขที่ src/ แล้วสร้างใหม่
 */
/* ======================================================================
 * Code.gs
 * ====================================================================== */
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
 *       doGet, include, getPublicConfig, login, resumeSession, register, firstRunSetup,
 *       requestPasswordReset, api
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
  VERSION: '1.10.0',
  TZ: 'Asia/Bangkok'
};

var ROLES = { USER: 'USER', EXECUTIVE: 'EXECUTIVE', ADMIN: 'ADMIN' };
var ROLE_LABELS = { USER: 'บุคลากร', EXECUTIVE: 'ผู้บริหาร', ADMIN: 'ผู้ดูแลระบบ' };

var EMP_STATUS = { PENDING: 'PENDING', ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', REJECTED: 'REJECTED' };
var EMP_STATUS_LABELS = { PENDING: 'รออนุมัติ', ACTIVE: 'ใช้งาน', INACTIVE: 'ปิดใช้งาน', REJECTED: 'ไม่อนุมัติ' };

var POSITIONS = ['ผู้อำนวยการ', 'ครู', 'บุคลากรทางการศึกษา', 'เจ้าหน้าที่อื่น ๆ'];

var LEAVE_TYPES = { SICK: 'ลาป่วย', PERSONAL: 'ลากิจ', VACATION: 'ลาพักผ่อน', MATERNITY: 'ลาคลอดบุตร', OFFICIAL: 'ไปราชการ', OTHER: 'อื่น ๆ' };
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
var THAI_DAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

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
    } else if (scriptProps_().INSTALLED_VERSION !== APP.VERSION) {
      // อัปเดตโค้ดเป็นเวอร์ชันใหม่: ปรับโครงสร้างฐานข้อมูลอัตโนมัติ (เพิ่มชีต/คอลัมน์/ค่าตั้งต้นที่ขาด ไม่ลบข้อมูลเดิม)
      try { setupCore_(); } catch (e) { console.error('auto upgrade failed: ' + (e && e.stack ? e.stack : e)); }
      resetMemo_();
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
        rememberDays: s ? s.rememberDays : 0,
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
    'auth.logoutAll': { fn: logoutAll_, mc: true },
    'auth.rememberDevice': { fn: rememberDevice_ },
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
    'leave.myStats': { fn: getMyLeaveStats_ },
    'leave.form': { fn: getLeaveForm_ },
    'corr.my': { fn: listMyCorrections_ },
    'corr.submit': { fn: submitCorrection_ },
    'corr.cancel': { fn: cancelCorrection_ },
    'file.get': { fn: getAttachment_ },
    // ----- ผู้บริหาร + ผู้ดูแลระบบ -----
    'admin.view': { fn: getAdminView_, roles: AE },
    'admin.overview': { fn: getAdminOverview_, roles: AE },
    'emp.basicList': { fn: listEmployeesBasic_, roles: AE },
    'admin.appLink': { fn: getAppLink_, roles: AE },
    'announce.save': { fn: saveAnnouncement_, roles: AE },
    'announce.clear': { fn: clearAnnouncement_, roles: AE },
    'leave.adminList': { fn: adminListLeaves_, roles: AE },
    'leave.adminCreate': { fn: adminRecordLeave_, roles: AE },
    'leave.review': { fn: reviewLeave_, roles: AE },
    'leave.approveMany': { fn: approveManyLeaves_, roles: AE },
    'corr.adminList': { fn: adminListCorrections_, roles: AE },
    'corr.review': { fn: reviewCorrection_, roles: AE },
    'corr.approveMany': { fn: approveManyCorrections_, roles: AE },
    'corr.adminCreate': { fn: adminRecordCorrection_, roles: AE },
    'report.daily': { fn: reportDaily_, roles: AE },
    'report.monthly': { fn: reportMonthly_, roles: AE },
    'report.yearly': { fn: reportYearly_, roles: AE },
    'report.individual': { fn: reportIndividual_, roles: AE },
    'report.leaveSummary': { fn: reportLeaveSummary_, roles: AE },
    'report.export': { fn: exportReport_, roles: AE },
    'cal.list': { fn: listCalendar_, roles: AE },
    // ----- ผู้ดูแลระบบเท่านั้น -----
    'emp.list': { fn: listEmployees_, roles: A },
    'emp.create': { fn: createEmployee_, roles: A },
    'emp.bulkCreate': { fn: bulkCreateEmployees_, roles: A },
    'emp.update': { fn: updateEmployee_, roles: A },
    'emp.setStatus': { fn: setEmployeeStatus_, roles: A },
    'emp.setRole': { fn: setEmployeeRole_, roles: A },
    'emp.approve': { fn: approveRegistration_, roles: A },
    'emp.reject': { fn: rejectRegistration_, roles: A },
    'emp.delete': { fn: deleteEmployee_, roles: A },
    'emp.resetPassword': { fn: resetEmployeePassword_, roles: A },
    'emp.unlock': { fn: unlockEmployee_, roles: A },
    'emp.dismissReset': { fn: dismissResetRequest_, roles: A },
    'settings.get': { fn: getSettingsForAdmin_, roles: A },
    'settings.save': { fn: saveSettings_, roles: A },
    'cal.add': { fn: addCalendarEntries_, roles: A },
    'cal.remove': { fn: removeCalendarEntry_, roles: A },
    'cal.addFixed': { fn: addFixedHolidays_, roles: A },
    'audit.list': { fn: listAuditLogs_, roles: A },
    'sys.rebuildSummary': { fn: rebuildDailySummary_, roles: A },
    'sys.runMaintenance': { fn: runMaintenanceNow_, roles: A },
    'sys.backup': { fn: backupNow_, roles: A }
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

/**
 * ปีงบประมาณ (พ.ศ.) ของวันที่ — ปีงบประมาณเริ่ม 1 ตุลาคม เช่น 1 ต.ค. 2569 – 30 ก.ย. 2570 = ปีงบประมาณ 2570
 */
function fiscalYearOf_(ymd) {
  var p = parseYmd_(ymd);
  return (p.m >= 10 ? p.y + 1 : p.y) + 543;
}

/**
 * ช่วงวันที่ของปีงบประมาณ / รอบการประเมิน
 * @param {number} fy ปีงบประมาณ (พ.ศ.)
 * @param {number} round 0 = ทั้งปีงบประมาณ, 1 = รอบที่ 1 (1 ต.ค. – 31 มี.ค.), 2 = รอบที่ 2 (1 เม.ย. – 30 ก.ย.)
 */
function fiscalRange_(fy, round) {
  var y = fy - 543; // ปี ค.ศ. ที่ปีงบประมาณสิ้นสุด
  var r = {
    fiscalYear: fy, round: round,
    from: round === 2 ? y + '-04-01' : (y - 1) + '-10-01',
    to: round === 1 ? y + '-03-31' : y + '-09-30'
  };
  r.label = round === 0 ? 'ปีงบประมาณ ' + fy : 'รอบที่ ' + round + ' ปีงบประมาณ ' + fy;
  r.rangeLabel = thaiDate_(r.from) + ' – ' + thaiDate_(r.to);
  r.shortLabel = round === 0 ? 'ทั้งปี' : (round === 1 ? 'ต.ค. – มี.ค.' : 'เม.ย. – ก.ย.');
  return r;
}
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

/* ======================================================================
 * Database.gs
 * ====================================================================== */
/**
 * ============================================================================
 *  Database.gs — โครงสร้างฐานข้อมูล Google Sheets, SetupSystem() และฟังก์ชัน CRUD
 * ============================================================================
 *  - ทุกชีตใช้แถวที่ 1 เป็นหัวตาราง (Header) และอ้างอิงคอลัมน์ด้วย "ชื่อ Header"
 *    → สลับลำดับคอลัมน์หรือเพิ่มคอลัมน์ใหม่ได้โดยไม่ทำให้ระบบเสีย
 *  - ข้อความทุกช่องถูกบันทึกเป็น Plain Text (นำหน้าด้วย ') เพื่อ
 *      1) ป้องกัน Google Sheets แปลง "00123" → 123 หรือ "2026-11-08" → Date
 *      2) ป้องกัน Formula Injection เช่น ชื่อที่ขึ้นต้นด้วย "=IMPORTXML(...)"
 *  - SetupSystem() เรียกซ้ำได้อย่างปลอดภัย: ไม่ลบชีต/ข้อมูลเดิม
 *    เพิ่มเฉพาะชีตหรือคอลัมน์ที่ยังไม่มี
 * ============================================================================
 */

/** ชนิดข้อมูล: str | date (yyyy-MM-dd) | time (HH:mm:ss) | datetime (yyyy-MM-dd HH:mm:ss) | num | bool */
var SCHEMA_ = {
  Employees: {
    color: '#0B2545',
    widths: { FullName: 200, PasswordHash: 160, Note: 200 },
    cols: [
      ['EmployeeID', 'str', 'รหัสภายในระบบ (สร้างอัตโนมัติ)'],
      ['StaffCode', 'str', 'รหัสประจำตัวบุคลากร (ไม่ซ้ำ)'],
      ['FullName', 'str', 'ชื่อ-นามสกุล'],
      ['Position', 'str', 'ตำแหน่ง'],
      ['Username', 'str', 'ชื่อผู้ใช้ (ตัวพิมพ์เล็ก ไม่ซ้ำ)'],
      ['PasswordHash', 'str', 'รหัสผ่านที่ผ่าน PBKDF2 + Salt + Pepper แล้ว (ห้ามแก้ไข)'],
      ['Role', 'str', 'สิทธิ์: USER=บุคลากร, EXECUTIVE=ผู้บริหาร, ADMIN=ผู้ดูแลระบบ'],
      ['Status', 'str', 'สถานะ: PENDING=รออนุมัติ, ACTIVE=ใช้งาน, INACTIVE=ปิดใช้งาน, REJECTED=ไม่อนุมัติ'],
      ['MustChangePassword', 'bool', 'TRUE = บังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป'],
      ['SessionVersion', 'num', 'เพิ่มค่าเมื่อต้องการให้ออกจากระบบทุกอุปกรณ์'],
      ['ActiveFrom', 'date', 'วันที่เริ่มนับสถิติ (วันที่อนุมัติ)'],
      ['ActiveTo', 'date', 'วันสุดท้ายที่นับสถิติ (วันที่ปิดใช้งาน) ว่าง = ยังใช้งาน'],
      ['CreatedAt', 'datetime', 'วันเวลาที่สร้างบัญชี'],
      ['CreatedBy', 'str', 'ผู้สร้างบัญชี (SELF = สมัครด้วยตนเอง)'],
      ['UpdatedAt', 'datetime', 'แก้ไขล่าสุด'],
      ['ApprovedBy', 'str', 'ผู้อนุมัติ'],
      ['ApprovedAt', 'datetime', 'วันเวลาที่อนุมัติ'],
      ['LastLoginAt', 'datetime', 'เข้าสู่ระบบล่าสุด'],
      ['Note', 'str', 'หมายเหตุ'],
      ['ResetRequestedAt', 'datetime', 'เวลาที่ขอรีเซ็ตรหัสผ่าน (ว่าง = ไม่มีคำขอ)'],
      ['ResetRequestNote', 'str', 'ข้อความ/ช่องทางติดต่อที่ผู้ขอรีเซ็ตรหัสผ่านแจ้งไว้']
    ]
  },
  AttendanceLogs: {
    color: '#13315C',
    widths: { FullName: 180, Note: 200 },
    cols: [
      ['AttendanceID', 'str', 'รหัสการลงเวลา'],
      ['EmployeeID', 'str', 'รหัสภายในของบุคลากร'],
      ['StaffCode', 'str', 'รหัสประจำตัวบุคลากร'],
      ['FullName', 'str', 'ชื่อ-นามสกุล'],
      ['Type', 'str', 'ประเภท: IN=เข้างาน, OUT=ออกงาน'],
      ['Date', 'date', 'วันที่ (yyyy-MM-dd ค.ศ.)'],
      ['Time', 'time', 'เวลา (HH:mm:ss) จาก Server'],
      ['Timestamp', 'datetime', 'วันเวลาที่บันทึกจริงบน Server'],
      ['Latitude', 'num', 'ละติจูด (ลบอัตโนมัติเมื่อครบระยะเวลาเก็บรักษา)'],
      ['Longitude', 'num', 'ลองจิจูด (ลบอัตโนมัติเมื่อครบระยะเวลาเก็บรักษา)'],
      ['Accuracy', 'num', 'ความแม่นยำ GPS (เมตร)'],
      ['DistanceM', 'num', 'ระยะห่างจากโรงเรียน (เมตร)'],
      ['Status', 'str', 'IN: ON_TIME/LATE/HOLIDAY, OUT: NORMAL/EARLY/HOLIDAY'],
      ['Source', 'str', 'ที่มา: GPS=ตรวจตำแหน่งแล้ว, NO_GPS=ลงเวลาออกโดยไม่ตรวจตำแหน่ง, CORRECTION=อนุมัติคำร้องแก้ไข'],
      ['IsActive', 'bool', 'FALSE = ถูกแทนที่ด้วยรายการแก้ไข (เก็บไว้เป็นประวัติ)'],
      ['SupersededBy', 'str', 'รหัสรายการที่มาแทนที่'],
      ['RefID', 'str', 'รหัสคำร้องที่อ้างอิง'],
      ['Note', 'str', 'หมายเหตุ']
    ]
  },
  DailySummary: {
    color: '#1B4F8A',
    widths: { Key: 220, FullName: 180 },
    cols: [
      ['Key', 'str', 'คีย์ วันที่|รหัสภายใน (ไม่ซ้ำ)'],
      ['Date', 'date', 'วันที่'],
      ['EmployeeID', 'str', 'รหัสภายในของบุคลากร'],
      ['StaffCode', 'str', 'รหัสประจำตัวบุคลากร'],
      ['FullName', 'str', 'ชื่อ-นามสกุล'],
      ['CheckInTime', 'time', 'เวลาเข้างาน'],
      ['CheckOutTime', 'time', 'เวลาออกงาน'],
      ['CheckInLogID', 'str', 'รหัสรายการเข้างาน'],
      ['CheckOutLogID', 'str', 'รหัสรายการออกงาน'],
      ['InDistanceM', 'num', 'ระยะห่างตอนเข้างาน (เมตร)'],
      ['OutDistanceM', 'num', 'ระยะห่างตอนออกงาน (เมตร)'],
      ['IsLate', 'bool', 'มาสาย'],
      ['LateMinutes', 'num', 'จำนวนนาทีที่สาย (นับจากเวลาเริ่มงาน)'],
      ['EarlyLeave', 'bool', 'ออกก่อนเวลาเลิกงาน'],
      ['WorkMinutes', 'num', 'ระยะเวลาปฏิบัติงาน (นาที)'],
      ['DayType', 'str', 'WORKDAY=วันทำงาน, HOLIDAY=วันหยุด'],
      ['Corrected', 'bool', 'มีการแก้ไขเวลาโดยคำร้อง'],
      ['UpdatedAt', 'datetime', 'ปรับปรุงล่าสุด']
    ]
  },
  WorkCalendar: {
    color: '#2E86C1',
    widths: { Title: 260 },
    cols: [
      ['Date', 'date', 'วันที่'],
      ['Type', 'str', 'OFFICIAL_HOLIDAY=วันหยุดราชการ, SPECIAL_HOLIDAY=วันหยุดพิเศษ, SPECIAL_WORKDAY=วันทำงานพิเศษ'],
      ['Title', 'str', 'ชื่อวันหยุด/รายละเอียด'],
      ['CreatedBy', 'str', 'ผู้บันทึก'],
      ['CreatedAt', 'datetime', 'วันเวลาที่บันทึก']
    ]
  },
  Settings: {
    color: '#0B2545',
    widths: { Key: 200, Value: 160, Description: 380 },
    cols: [
      ['Key', 'str', 'ชื่อการตั้งค่า'],
      ['Value', 'str', 'ค่า'],
      ['Description', 'str', 'คำอธิบาย'],
      ['UpdatedAt', 'datetime', 'แก้ไขล่าสุด'],
      ['UpdatedBy', 'str', 'ผู้แก้ไข']
    ]
  },
  LeaveRequests: {
    color: '#117A65',
    widths: { FullName: 180, Reason: 260, ReviewNote: 200 },
    cols: [
      ['LeaveID', 'str', 'รหัสใบลา'],
      ['EmployeeID', 'str', 'รหัสภายในของบุคลากร'],
      ['StaffCode', 'str', 'รหัสประจำตัวบุคลากร'],
      ['FullName', 'str', 'ชื่อ-นามสกุล'],
      ['LeaveType', 'str', 'SICK=ลาป่วย, PERSONAL=ลากิจ, VACATION=ลาพักผ่อน, MATERNITY=ลาคลอดบุตร, OFFICIAL=ไปราชการ, OTHER=อื่น ๆ'],
      ['TypeDetail', 'str', 'ประเภทการลาที่พิมพ์เอง (กรณี OTHER เช่น ลาอุปสมบท)'],
      ['StartDate', 'date', 'วันที่เริ่มลา'],
      ['EndDate', 'date', 'วันที่สิ้นสุด'],
      ['Period', 'str', 'FULL=เต็มวัน, MORNING=ครึ่งวันเช้า, AFTERNOON=ครึ่งวันบ่าย'],
      ['Days', 'num', 'จำนวนวันทำการที่ลา'],
      ['Reason', 'str', 'เหตุผล'],
      ['AttachmentFileId', 'str', 'รหัสไฟล์เอกสารประกอบใน Google Drive (ไม่เปิดสาธารณะ)'],
      ['AttachmentName', 'str', 'ชื่อไฟล์เอกสารประกอบ'],
      ['Status', 'str', 'PENDING / APPROVED / REJECTED / CANCELLED'],
      ['RequestedAt', 'datetime', 'วันเวลาที่ยื่น'],
      ['RecordedBy', 'str', 'ผู้บันทึก: SELF = บุคลากรบันทึกเอง หรือชื่อผู้บริหาร/ผู้ดูแลที่บันทึกให้'],
      ['ReviewedBy', 'str', 'รหัสผู้พิจารณา (AUTO = อนุมัติอัตโนมัติ)'],
      ['ReviewedByName', 'str', 'ชื่อผู้พิจารณา'],
      ['ReviewedAt', 'datetime', 'วันเวลาที่พิจารณา'],
      ['ReviewNote', 'str', 'ความเห็นผู้พิจารณา']
    ]
  },
  CorrectionRequests: {
    color: '#B9770E',
    widths: { FullName: 180, Reason: 260, ReviewNote: 200 },
    cols: [
      ['RequestID', 'str', 'รหัสคำร้อง'],
      ['EmployeeID', 'str', 'รหัสภายในของบุคลากร'],
      ['StaffCode', 'str', 'รหัสประจำตัวบุคลากร'],
      ['FullName', 'str', 'ชื่อ-นามสกุล'],
      ['Date', 'date', 'วันที่ต้องการแก้ไข'],
      ['Type', 'str', 'IN=เวลาเข้า, OUT=เวลาออก'],
      ['RequestedTime', 'time', 'เวลาที่แจ้งแก้ไข'],
      ['Reason', 'str', 'เหตุผล'],
      ['AttachmentFileId', 'str', 'รหัสไฟล์หลักฐานใน Google Drive'],
      ['AttachmentName', 'str', 'ชื่อไฟล์หลักฐาน'],
      ['Status', 'str', 'PENDING / APPROVED / REJECTED / CANCELLED'],
      ['RequestedAt', 'datetime', 'วันเวลาที่ยื่น'],
      ['ReviewedBy', 'str', 'รหัสผู้พิจารณา'],
      ['ReviewedByName', 'str', 'ชื่อผู้พิจารณา'],
      ['ReviewedAt', 'datetime', 'วันเวลาที่พิจารณา'],
      ['ReviewNote', 'str', 'ความเห็นผู้พิจารณา'],
      ['OldAttendanceID', 'str', 'รหัสรายการเดิมที่ถูกแทนที่ (ถ้ามี)'],
      ['NewAttendanceID', 'str', 'รหัสรายการใหม่ที่สร้างจากคำร้อง'],
      ['RecordedBy', 'str', 'ผู้บันทึก: SELF = บุคลากรยื่นเอง หรือชื่อผู้บริหาร/ผู้ดูแลที่บันทึกเวลาแทน']
    ]
  },
  AuditLogs: {
    color: '#5D6D7E',
    widths: { Details: 420, ActorName: 180 },
    cols: [
      ['LogID', 'str', 'รหัสบันทึก'],
      ['Timestamp', 'datetime', 'วันเวลา'],
      ['ActorID', 'str', 'รหัสผู้กระทำ'],
      ['ActorName', 'str', 'ชื่อผู้กระทำ'],
      ['ActorRole', 'str', 'สิทธิ์ผู้กระทำ'],
      ['Action', 'str', 'การกระทำ'],
      ['TargetType', 'str', 'ประเภทข้อมูลเป้าหมาย'],
      ['TargetID', 'str', 'รหัสข้อมูลเป้าหมาย'],
      ['Details', 'str', 'รายละเอียด (JSON: ข้อมูลก่อน/หลังแก้ไข)']
    ]
  },
  Sessions: {
    color: '#5D6D7E',
    widths: { UserAgent: 320 },
    cols: [
      ['SessionRef', 'str', 'รหัสอ้างอิงเซสชัน (ไม่ใช่ token จริง)'],
      ['EmployeeID', 'str', 'รหัสภายในของบุคลากร'],
      ['Username', 'str', 'ชื่อผู้ใช้'],
      ['LoginAt', 'datetime', 'เวลาเข้าสู่ระบบ'],
      ['LogoutAt', 'datetime', 'เวลาออกจากระบบ'],
      ['EndReason', 'str', 'LOGOUT / PASSWORD_CHANGED / LOGOUT_ALL'],
      ['UserAgent', 'str', 'อุปกรณ์/เบราว์เซอร์'],
      ['RememberUntil', 'datetime', 'จดจำการเข้าสู่ระบบบนอุปกรณ์นี้ถึงเวลา (ว่าง = ไม่จดจำ)'],
      ['DeviceKeyHash', 'str', 'SHA-256 ของรหัสอุปกรณ์ (ไม่เก็บรหัสจริง)'],
      ['SessionVersion', 'num', 'SessionVersion ของบัญชีขณะจดจำ (เปลี่ยนรหัสผ่าน = ใช้ไม่ได้)'],
      ['LastSeenAt', 'datetime', 'ใช้งานล่าสุดผ่านการจดจำอุปกรณ์']
    ]
  }
};

/** ค่าเริ่มต้นการตั้งค่า (ตัวอย่างสำหรับทดลอง — โรงเรียนต้องปรับตามระเบียบจริงก่อนใช้งาน) */
var DEFAULT_SETTINGS_ = [
  ['SCHOOL_LAT', '', 'ละติจูดจุดศูนย์กลางโรงเรียน (ต้องตั้งค่าก่อนเปิดใช้งาน)'],
  ['SCHOOL_LNG', '', 'ลองจิจูดจุดศูนย์กลางโรงเรียน (ต้องตั้งค่าก่อนเปิดใช้งาน)'],
  ['GEOFENCE_RADIUS_M', '150', 'รัศมีพื้นที่ที่อนุญาตให้ลงเวลา (เมตร) ค่าทดลอง 150'],
  ['MAX_GPS_ACCURACY_M', '50', 'ค่าความคลาดเคลื่อน GPS สูงสุดที่ยอมรับ (เมตร) ค่าทดลอง 50'],
  ['CHECKOUT_REQUIRES_GPS', 'FALSE', 'ลงเวลาออกงานต้องอยู่ในพื้นที่โรงเรียน (ตรวจ GPS) — FALSE = ลงเวลาออกได้ทุกที่'],
  ['WORK_START_TIME', '08:00', 'เวลาเริ่มปฏิบัติงาน (ตัวอย่าง)'],
  ['LATE_AFTER_TIME', '08:30', 'ลงเวลาเข้าหลังเวลานี้ถือว่ามาสาย (ตัวอย่าง)'],
  ['WORK_END_TIME', '16:30', 'เวลาเลิกงาน (ตัวอย่าง)'],
  ['CHECKIN_EARLIEST_TIME', '05:00', 'เวลาเร็วที่สุดที่เปิดให้ลงเวลาเข้างาน'],
  ['WORK_DAYS', '1,2,3,4,5', 'วันทำงานประจำสัปดาห์ 0=อาทิตย์ 1=จันทร์ ... 6=เสาร์'],
  ['ALLOW_HOLIDAY_CHECKIN', 'TRUE', 'อนุญาตให้ลงเวลาในวันหยุด (ปฏิบัติงานวันหยุด)'],
  ['SESSION_TIMEOUT_MIN', '30', 'ออกจากระบบอัตโนมัติเมื่อไม่ได้ใช้งาน (นาที)'],
  ['MAX_LOGIN_ATTEMPTS', '5', 'จำนวนครั้งที่ใส่รหัสผ่านผิดได้ก่อนล็อกชั่วคราว'],
  ['LOCKOUT_MIN', '15', 'ระยะเวลาล็อกบัญชีชั่วคราว (นาที)'],
  ['REMEMBER_DEVICE_DAYS', '30', 'จดจำการเข้าสู่ระบบบนอุปกรณ์ส่วนตัว (วันนับจากใช้งานล่าสุด) 0 = ปิด'],
  ['GPS_RETENTION_DAYS', '365', 'ระยะเวลาเก็บพิกัด GPS ก่อนลบอัตโนมัติ (วัน)'],
  ['CORRECTION_MAX_DAYS', '30', 'ยื่นคำร้องแก้ไขเวลาย้อนหลังได้ไม่เกิน (วัน)'],
  ['LEAVE_REQUIRES_APPROVAL', 'TRUE', 'การลาที่บุคลากรบันทึกเองต้องรอผู้บริหาร/ผู้ดูแลอนุมัติ (FALSE = มีผลทันทีเมื่อกดยืนยัน)'],
  ['ALLOW_REGISTRATION', 'TRUE', 'เปิดให้บุคลากรสมัครสมาชิกด้วยตนเอง'],
  ['DIRECTOR_NAME', '', 'ชื่อ-นามสกุลผู้อำนวยการโรงเรียน (ใช้ในช่องลงนามของใบลาและรายงาน)'],
  ['DIRECTOR_POSITION', 'ผู้อำนวยการโรงเรียนวัดเสาหิน', 'ตำแหน่งผู้ลงนามอนุญาตการลา/รับรองรายงาน'],
  ['SCHOOL_AFFILIATION', '', 'สังกัดของโรงเรียน เช่น สำนักงานเขตพื้นที่การศึกษาประถมศึกษา... (ใช้ในใบลา)'],
  ['SETTINGS_CONFIRMED', 'FALSE', 'ผู้ดูแลยืนยันว่าได้ปรับค่าตามระเบียบโรงเรียนแล้ว']
];

/* ========================================================================== */
/*  Per-execution memo                                                        */
/* ========================================================================== */

var MEMO_ = {};

/** ล้างข้อมูลชั่วคราวของการทำงานรอบนี้ (เรียกที่จุดเริ่มของทุก entry point) */
function resetMemo_() { MEMO_ = {}; }

function scriptProps_() {
  if (!MEMO_.props) MEMO_.props = PropertiesService.getScriptProperties().getProperties();
  return MEMO_.props;
}

/* ========================================================================== */
/*  Spreadsheet access                                                        */
/* ========================================================================== */

function getSpreadsheet_() {
  if (MEMO_.ss) return MEMO_.ss;
  var id = scriptProps_().SPREADSHEET_ID;
  var ss = null;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  }
  if (!ss) throw appError_('ระบบยังไม่ได้ติดตั้งฐานข้อมูล กรุณาให้ผู้ดูแลรัน SetupSystem()', 'NOT_SETUP');
  MEMO_.ss = ss;
  return ss;
}

/** ตรวจว่าระบบติดตั้งแล้ว (มีฐานข้อมูลและกุญแจเข้ารหัส) */
function isSystemReady_() {
  var p = scriptProps_();
  if (!p.PASSWORD_PEPPER || !p.SPREADSHEET_ID) return false;
  try {
    var ss = getSpreadsheet_();
    return !!ss.getSheetByName('Employees') && !!ss.getSheetByName('Settings');
  } catch (e) {
    return false;
  }
}

function ensureReady_() {
  if (!isSystemReady_()) {
    throw appError_('ระบบยังไม่ได้ติดตั้ง กรุณาให้ผู้ดูแลระบบรันฟังก์ชัน SetupSystem() ก่อนใช้งาน', 'NOT_SETUP');
  }
}

/** ข้อมูลโครงสร้างตาราง (header → index) */
function getTable_(name) {
  MEMO_.tables = MEMO_.tables || {};
  if (MEMO_.tables[name]) return MEMO_.tables[name];
  var schema = SCHEMA_[name];
  if (!schema) throw new Error('Unknown table: ' + name);
  var sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw appError_('ไม่พบชีต "' + name + '" กรุณารัน SetupSystem()', 'NOT_SETUP');
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var idx = {};
  headers.forEach(function (h, i) { if (h && !(h in idx)) idx[h] = i; });
  var types = {};
  schema.cols.forEach(function (c) {
    types[c[0]] = c[1];
    if (!(c[0] in idx)) {
      throw appError_('โครงสร้างชีต ' + name + ' ไม่ครบ (ขาดคอลัมน์ ' + c[0] + ') กรุณารัน SetupSystem()', 'NOT_SETUP');
    }
  });
  var t = { name: name, sheet: sh, headers: headers, idx: idx, types: types, width: headers.length };
  MEMO_.tables[name] = t;
  return t;
}

/* ---------- แปลงค่า Cell ↔ ค่าใน JavaScript ---------- */

function cellFromValue_(v, type) {
  if (v === null || v === undefined) return '';
  if (type === 'num') {
    var n = typeof v === 'number' ? v : toNumber_(v);
    return isFinite(n) ? n : '';
  }
  if (type === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
  var s = String(v);
  if (s === '') return '';
  return "'" + s; // บังคับเป็นข้อความ + ป้องกันสูตร
}

function valueFromCell_(v, type) {
  if (type === 'num') {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  if (type === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
  if (v instanceof Date) {
    if (type === 'date') return fmt_(v, 'yyyy-MM-dd');
    if (type === 'time') return fmt_(v, 'HH:mm:ss');
    return fmt_(v, 'yyyy-MM-dd HH:mm:ss');
  }
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (s.charAt(0) === "'") s = s.substr(1); // กันกรณีเครื่องหมาย ' ถูกเก็บเป็นข้อความ
  if (type === 'time' && /^\d:\d\d/.test(s)) s = '0' + s;
  return s;
}

function rowToRecord_(t, row, rowNum) {
  var rec = { _row: rowNum };
  for (var h in t.types) {
    rec[h] = valueFromCell_(row[t.idx[h]], t.types[h]);
  }
  return rec;
}

function recordToRow_(t, rec, baseRow) {
  var row = baseRow ? baseRow.slice() : [];
  for (var i = 0; i < t.width; i++) if (row[i] === undefined) row[i] = '';
  for (var h in t.types) {
    if (Object.prototype.hasOwnProperty.call(rec, h)) row[t.idx[h]] = cellFromValue_(rec[h], t.types[h]);
    else if (!baseRow) row[t.idx[h]] = '';
  }
  return row;
}

function isEmptyRow_(row) {
  for (var i = 0; i < row.length; i++) if (row[i] !== '' && row[i] !== null) return false;
  return true;
}

/* ---------- อ่านข้อมูล ---------- */

/** อ่านทุกแถวของตาราง (แคชในการทำงานรอบนี้) */
function readAll_(name) {
  MEMO_.rows = MEMO_.rows || {};
  if (MEMO_.rows[name]) return MEMO_.rows[name];
  var t = getTable_(name);
  var last = t.sheet.getLastRow();
  var out = [];
  if (last >= 2) {
    var values = t.sheet.getRange(2, 1, last - 1, t.width).getValues();
    for (var i = 0; i < values.length; i++) {
      if (isEmptyRow_(values[i])) continue;
      out.push(rowToRecord_(t, values[i], i + 2));
    }
  }
  MEMO_.rows[name] = out;
  return out;
}

/** อ่าน n แถวล่าสุด (เช่น Audit Log) */
function readTail_(name, n) {
  var t = getTable_(name);
  var last = t.sheet.getLastRow();
  if (last < 2) return [];
  var start = Math.max(2, last - n + 1);
  var values = t.sheet.getRange(start, 1, last - start + 1, t.width).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (!isEmptyRow_(values[i])) out.push(rowToRecord_(t, values[i], start + i));
  }
  return out;
}

function getRecord_(name, rowNum) {
  var t = getTable_(name);
  if (rowNum < 2 || rowNum > t.sheet.getLastRow()) return null;
  var row = t.sheet.getRange(rowNum, 1, 1, t.width).getValues()[0];
  return isEmptyRow_(row) ? null : rowToRecord_(t, row, rowNum);
}

/** ค้นหาเลขแถวด้วยค่าที่ตรงกันทั้งช่อง (ใช้ TextFinder — เร็วกว่าการอ่านทั้งชีต) */
function findRowNumbers_(name, field, value) {
  var t = getTable_(name);
  var last = t.sheet.getLastRow();
  if (last < 2 || value === '' || value === null || value === undefined) return [];
  var col = t.idx[field] + 1;
  var cells = t.sheet.getRange(2, col, last - 1, 1)
    .createTextFinder(String(value))
    .matchEntireCell(true)
    .matchCase(true)
    .findAll();
  return cells.map(function (c) { return c.getRow(); });
}

/** ค้นหา 1 รายการด้วยค่าที่ไม่ซ้ำ (เช่น ID) และยืนยันค่าซ้ำอีกครั้ง */
function findOne_(name, field, value) {
  var rows = findRowNumbers_(name, field, value);
  for (var i = 0; i < rows.length; i++) {
    var rec = getRecord_(name, rows[i]);
    if (rec && String(rec[field]) === String(value)) return rec;
  }
  return null;
}

/* ---------- เขียนข้อมูล (ควรเรียกภายใต้ withLock_) ---------- */

function appendRecord_(name, rec) {
  var t = getTable_(name);
  t.sheet.appendRow(recordToRow_(t, rec, null));
  markDirty_(name);
  return t.sheet.getLastRow();
}

function appendRecords_(name, recs) {
  if (!recs.length) return;
  var t = getTable_(name);
  var rows = recs.map(function (r) { return recordToRow_(t, r, null); });
  var start = t.sheet.getLastRow() + 1;
  ensureRows_(t.sheet, start + rows.length - 1);
  t.sheet.getRange(start, 1, rows.length, t.width).setValues(rows);
  markDirty_(name);
}

function ensureRows_(sheet, lastNeeded) {
  var max = sheet.getMaxRows();
  if (lastNeeded > max) sheet.insertRowsAfter(max, lastNeeded - max);
}

/** แก้ไขแถวเดิม (merge เฉพาะ field ที่ส่งมา) → คืนค่าระเบียนหลังแก้ไข */
function updateRecord_(name, rowNum, patch) {
  var t = getTable_(name);
  var range = t.sheet.getRange(rowNum, 1, 1, t.width);
  var current = range.getValues()[0];
  var row = recordToRow_(t, patch, current);
  // ค่าเดิมที่ไม่ได้แก้ไข: เขียนกลับในรูปข้อความเพื่อคงรูปแบบ
  for (var h in t.types) {
    if (!Object.prototype.hasOwnProperty.call(patch, h)) {
      row[t.idx[h]] = cellFromValue_(valueFromCell_(current[t.idx[h]], t.types[h]), t.types[h]);
    }
  }
  range.setValues([row]);
  markDirty_(name);
  var merged = rowToRecord_(t, current, rowNum);
  for (var k in patch) if (Object.prototype.hasOwnProperty.call(t.types, k)) merged[k] = patch[k];
  return merged;
}

/** ค้นหาด้วย ID แล้วแก้ไข — ไม่เชื่อเลขแถวจากแคช */
function updateById_(name, idField, id, patch) {
  var rec = findOne_(name, idField, id);
  if (!rec) throw appError_('ไม่พบข้อมูลที่ต้องการแก้ไข', 'NOT_FOUND');
  return updateRecord_(name, rec._row, patch);
}

function deleteRowNumber_(name, rowNum) {
  var t = getTable_(name);
  t.sheet.deleteRow(rowNum);
  markDirty_(name);
}

/* ========================================================================== */
/*  Cache (CacheService + versioned keys)                                     */
/* ========================================================================== */
/*  ใช้ "เวอร์ชัน" ที่เก็บใน Script Properties เป็นส่วนหนึ่งของคีย์แคช
 *  เมื่อมีการแก้ไขตาราง เวอร์ชันจะเปลี่ยน → แคชเก่าใช้ไม่ได้ทันทีทุกการทำงาน
 *  (ป้องกันกรณีปิดใช้งานบัญชีแล้วแคชเก่ายังอนุญาตให้ใช้งาน)                     */

var CACHED_TABLES_ = { Employees: true, Settings: true, WorkCalendar: true };

function markDirty_(name) {
  if (MEMO_.rows) delete MEMO_.rows[name];
  if (name === 'Employees') delete MEMO_.emps;
  if (name === 'Settings') delete MEMO_.settings;
  if (name === 'WorkCalendar') delete MEMO_.calendar;
  if (CACHED_TABLES_[name]) {
    MEMO_.dirty = MEMO_.dirty || {};
    MEMO_.dirty[name] = true;
  }
}

/** เรียกหลัง SpreadsheetApp.flush() เพื่อเปลี่ยนเวอร์ชันแคชของตารางที่แก้ไข */
function commitDirtyTables_() {
  if (!MEMO_.dirty) return;
  var props = PropertiesService.getScriptProperties();
  var patch = {};
  for (var name in MEMO_.dirty) patch['CACHE_VER_' + name] = String(nowMs_()) + '-' + Math.floor(Math.random() * 1e6);
  props.setProperties(patch);
  if (MEMO_.props) for (var k in patch) MEMO_.props[k] = patch[k];
  MEMO_.dirty = {};
}

function cacheKeyFor_(name) {
  return 'tbl_' + name + '_' + (scriptProps_()['CACHE_VER_' + name] || '0');
}

function cachedRead_(name, builder, ttlSec) {
  var cache = CacheService.getScriptCache();
  var key = cacheKeyFor_(name);
  var raw = null;
  try { raw = cache.get(key); } catch (e) { raw = null; }
  if (raw) {
    try { return JSON.parse(raw); } catch (e2) { /* rebuild */ }
  }
  var data = builder();
  var json = JSON.stringify(data);
  if (json.length < 95000) {
    try { cache.put(key, json, ttlSec || 600); } catch (e3) { /* ignore */ }
  }
  return data;
}

/* ========================================================================== */
/*  Domain readers                                                            */
/* ========================================================================== */

/** รายชื่อบุคลากรทั้งหมด (ไม่มี PasswordHash) */
function getEmployees_() {
  if (MEMO_.emps) return MEMO_.emps;
  MEMO_.emps = cachedRead_('Employees', function () {
    return readAll_('Employees').map(function (e) {
      var c = {};
      for (var k in e) if (k !== 'PasswordHash' && k !== '_row') c[k] = e[k];
      return c;
    });
  }, 600);
  return MEMO_.emps;
}

function getEmployeeById_(id) {
  var list = getEmployees_();
  for (var i = 0; i < list.length; i++) if (list[i].EmployeeID === id) return list[i];
  return null;
}

/** บุคลากรที่ใช้งานอยู่ (ACTIVE) เรียงตามรหัสบุคลากร */
function getActiveEmployees_() {
  return getEmployees_().filter(function (e) { return e.Status === EMP_STATUS.ACTIVE; })
    .sort(function (a, b) { return String(a.StaffCode).localeCompare(String(b.StaffCode), 'th', { numeric: true }); });
}

/** การตั้งค่าแบบแปลงชนิดข้อมูลแล้ว */
function getSettings_() {
  if (MEMO_.settings) return MEMO_.settings;
  var raw = cachedRead_('Settings', function () {
    var map = {};
    DEFAULT_SETTINGS_.forEach(function (d) { map[d[0]] = d[1]; });
    readAll_('Settings').forEach(function (r) { if (r.Key) map[r.Key] = r.Value; });
    return map;
  }, 600);
  MEMO_.settings = parseSettings_(raw);
  return MEMO_.settings;
}

function parseSettings_(raw) {
  function num(k, def) { var n = toNumber_(raw[k]); return isFinite(n) ? n : def; }
  function bool(k) { return String(raw[k]).toUpperCase() === 'TRUE'; }
  function time(k, def) { return isValidTime_(raw[k]) ? String(raw[k]).substr(0, 5) : def; }
  var lat = toNumber_(raw.SCHOOL_LAT), lng = toNumber_(raw.SCHOOL_LNG);
  var workDays = String(raw.WORK_DAYS || '').split(',').map(function (x) { return parseInt(x, 10); })
    .filter(function (x) { return x >= 0 && x <= 6; });
  return {
    raw: raw,
    schoolLat: isFinite(lat) ? lat : null,
    schoolLng: isFinite(lng) ? lng : null,
    geofenceConfigured: isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0),
    radiusM: num('GEOFENCE_RADIUS_M', 150),
    maxAccuracyM: num('MAX_GPS_ACCURACY_M', 50),
    workStart: time('WORK_START_TIME', '08:00'),
    lateAfter: time('LATE_AFTER_TIME', '08:30'),
    workEnd: time('WORK_END_TIME', '16:30'),
    checkinEarliest: time('CHECKIN_EARLIEST_TIME', '05:00'),
    workDays: workDays.length ? workDays : [1, 2, 3, 4, 5],
    allowHolidayCheckin: bool('ALLOW_HOLIDAY_CHECKIN'),
    checkoutRequiresGps: bool('CHECKOUT_REQUIRES_GPS'),
    sessionTimeoutMin: Math.min(360, Math.max(5, num('SESSION_TIMEOUT_MIN', 30))),
    maxLoginAttempts: Math.min(20, Math.max(3, num('MAX_LOGIN_ATTEMPTS', 5))),
    lockoutMin: Math.min(1440, Math.max(1, num('LOCKOUT_MIN', 15))),
    rememberDays: Math.min(90, Math.max(0, num('REMEMBER_DEVICE_DAYS', 30))),
    gpsRetentionDays: Math.max(30, num('GPS_RETENTION_DAYS', 365)),
    correctionMaxDays: Math.max(1, num('CORRECTION_MAX_DAYS', 30)),
    allowRegistration: bool('ALLOW_REGISTRATION'),
    directorName: String(raw.DIRECTOR_NAME || '').trim(),
    directorPosition: String(raw.DIRECTOR_POSITION || '').trim() || 'ผู้อำนวยการ' + APP.SCHOOL_NAME,
    affiliation: String(raw.SCHOOL_AFFILIATION || '').trim(),
    leaveRequiresApproval: String(raw.LEAVE_REQUIRES_APPROVAL === undefined ? 'TRUE' : raw.LEAVE_REQUIRES_APPROVAL).toUpperCase() !== 'FALSE',
    settingsConfirmed: bool('SETTINGS_CONFIRMED')
  };
}

/** ปฏิทินวันหยุด/วันทำงานพิเศษ: { 'yyyy-MM-dd': {type, title} } */
function getCalendarMap_() {
  if (MEMO_.calendar) return MEMO_.calendar;
  MEMO_.calendar = cachedRead_('WorkCalendar', function () {
    var map = {};
    readAll_('WorkCalendar').forEach(function (r) {
      if (isValidYmd_(r.Date)) map[r.Date] = { type: r.Type, title: r.Title };
    });
    return map;
  }, 600);
  return MEMO_.calendar;
}

/** ข้อมูลประเภทวัน: วันทำงานหรือวันหยุด */
function getDayInfo_(ymd, settings, calMap) {
  settings = settings || getSettings_();
  calMap = calMap || getCalendarMap_();
  var dow = dayOfWeek_(ymd);
  var entry = calMap[ymd];
  var isWorkday = settings.workDays.indexOf(dow) >= 0;
  var holidayName = '';
  if (entry) {
    if (entry.type === 'SPECIAL_WORKDAY') isWorkday = true;
    else { isWorkday = false; holidayName = entry.title || CALENDAR_TYPES[entry.type] || 'วันหยุด'; }
  } else if (!isWorkday) {
    holidayName = 'วันหยุดประจำสัปดาห์';
  }
  return { date: ymd, dow: dow, dayName: THAI_DAYS[dow], isWorkday: isWorkday, holidayName: holidayName, calendar: entry || null };
}

/* ========================================================================== */
/*  Audit log                                                                 */
/* ========================================================================== */

/**
 * บันทึกประวัติการกระทำ (append-only)
 * @param {Object|null} ctx context ของผู้กระทำ (null = ระบบ)
 */
function writeAudit_(ctx, action, targetType, targetId, details) {
  try {
    var actor = ctx && ctx.user ? ctx.user : (ctx && ctx.EmployeeID ? ctx : null);
    var json = '';
    try { json = details ? JSON.stringify(details) : ''; } catch (e) { json = String(details); }
    appendRecord_('AuditLogs', {
      LogID: newId_('LOG'),
      Timestamp: nowStamp_(),
      ActorID: actor ? actor.EmployeeID : 'SYSTEM',
      ActorName: actor ? actor.FullName : 'ระบบ',
      ActorRole: actor ? actor.Role : 'SYSTEM',
      Action: action,
      TargetType: targetType || '',
      TargetID: targetId || '',
      Details: json.substr(0, 45000)
    });
  } catch (err) {
    console.error('writeAudit_ failed: ' + err);
  }
}

/* ========================================================================== */
/*  SetupSystem — สร้างชีต/หัวตาราง/การตั้งค่าเริ่มต้น (เรียกซ้ำได้ ไม่ลบข้อมูลเดิม) */
/* ========================================================================== */

/**
 * ติดตั้งระบบ: รันจาก Apps Script Editor (เลือกฟังก์ชัน SetupSystem แล้วกด Run)
 * - สร้าง/ตรวจสอบชีตทั้ง 9 ชีตพร้อมหัวตาราง
 * - เพิ่มการตั้งค่าเริ่มต้นที่ยังไม่มี
 * - สร้างกุญแจเข้ารหัส (Pepper) ใน Script Properties ถ้ายังไม่มี
 * - สร้างโฟลเดอร์ Google Drive สำหรับเอกสารแนบ/ไฟล์รายงานชั่วคราว
 * - ติดตั้ง Trigger งานบำรุงรักษารายวัน (ลบพิกัด GPS ที่เกินระยะเวลาเก็บรักษา)
 */
function SetupSystem() {
  assertOwnerContext_();
  var text = setupCore_();
  Logger.log(text);
  return text;
}

/**
 * ขั้นตอนติดตั้งจริง (เรียกซ้ำได้อย่างปลอดภัย) — ใช้โดย SetupSystem() จาก Editor
 * และโดยการติดตั้งอัตโนมัติเมื่อมีผู้เปิดเว็บแอปครั้งแรก (งานที่ทำไม่เปิดเผยข้อมูลลับใด ๆ)
 */
function setupCore_() {
  resetMemo_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var log = [];
  try {
    var props = PropertiesService.getScriptProperties();
    var ss = null;
    var id = props.getProperty('SPREADSHEET_ID');
    if (id) {
      ss = SpreadsheetApp.openById(id);
      log.push('ใช้ Spreadsheet เดิม: ' + ss.getName());
    } else {
      try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
      if (ss) {
        log.push('ใช้ Spreadsheet ที่ผูกกับสคริปต์: ' + ss.getName());
      } else {
        ss = SpreadsheetApp.create(DB_FILE_NAME_);
        log.push('สร้าง Spreadsheet ใหม่: ' + ss.getName());
      }
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
    MEMO_.ss = ss;
    ss.setSpreadsheetTimeZone(APP.TZ);

    Object.keys(SCHEMA_).forEach(function (name) {
      var r = ensureSheet_(ss, name, SCHEMA_[name]);
      log.push((r.created ? '✔ สร้างชีต ' : '• มีชีตอยู่แล้ว ') + name +
        (r.added.length ? ' (เพิ่มคอลัมน์: ' + r.added.join(', ') + ')' : ''));
    });
    removeDefaultSheet_(ss);

    var addedSettings = ensureDefaultSettings_();
    log.push(addedSettings.length ? '✔ เพิ่มการตั้งค่าเริ่มต้น: ' + addedSettings.join(', ') : '• การตั้งค่าครบแล้ว');
    try {
      var yNow = +todayStr_().substr(0, 4);
      var seeded = seedThaiHolidays_([yNow, yNow + 1]);
      log.push(seeded ? '✔ เพิ่มวันหยุดราชการไทยลงปฏิทิน ' + seeded + ' วัน (ปี พ.ศ. ' + (yNow + 543) + '–' + (yNow + 544) + ')' : '• ปฏิทินวันหยุดราชการไทยเป็นปัจจุบัน');
    } catch (eh) { log.push('⚠ เพิ่มวันหยุดราชการไทยไม่สำเร็จ: ' + eh.message); }

    if (!props.getProperty('PASSWORD_PEPPER')) {
      props.setProperty('PASSWORD_PEPPER', randomHex_(32));
      log.push('✔ สร้างกุญแจเข้ารหัสรหัสผ่าน (PASSWORD_PEPPER) — ห้ามลบหรือแก้ไข');
    } else {
      log.push('• มีกุญแจเข้ารหัสอยู่แล้ว');
    }
    if (!props.getProperty('PBKDF2_ITERATIONS')) props.setProperty('PBKDF2_ITERATIONS', String(CRYPTO_.DEFAULT_ITERATIONS));

    try { log = log.concat(ensureDriveFolders_()); } catch (e1) { log.push('⚠ สร้างโฟลเดอร์ Drive ไม่สำเร็จ: ' + e1.message); }
    try { log = log.concat(ensureTriggers_()); } catch (e2) { log.push('⚠ ติดตั้ง Trigger ไม่สำเร็จ (รัน SetupSystem จาก Editor ภายหลังได้): ' + e2.message); }

    SpreadsheetApp.flush();
    MEMO_.dirty = { Employees: true, Settings: true, WorkCalendar: true };
    commitDirtyTables_();
    resetMemo_();
    MEMO_.ss = ss;
    if (hasActiveAdmin_()) {
      removeSetupCode_();
      log.push('• มีผู้ดูแลระบบแล้ว');
    } else {
      var code = ensureSetupCode_();
      log.push('➜ ขั้นต่อไป: เปิด URL เว็บแอป แล้วกรอกรหัสติดตั้ง ' + code +
        ' (ดูได้ในชีต "' + SETUP_SHEET_ + '") เพื่อสร้างผู้ดูแลระบบคนแรก — หรือใช้ CreateFirstAdmin() แบบเดิม');
    }
    SpreadsheetApp.flush();
    props.setProperty('INSTALLED_VERSION', APP.VERSION);
    log.push('ติดตั้งระบบเสร็จสมบูรณ์ ✔ (เวอร์ชัน ' + APP.VERSION + ')');
  } finally {
    lock.releaseLock();
  }
  return log.join('\n');
}

var DB_FILE_NAME_ = 'ฐานข้อมูลระบบลงเวลา โรงเรียนวัดเสาหิน';
var SETUP_SHEET_ = 'เริ่มต้นใช้งาน';

function hasActiveAdmin_() {
  return getEmployees_().some(function (e) { return e.Role === ROLES.ADMIN && e.Status === EMP_STATUS.ACTIVE; });
}

/**
 * รหัสติดตั้งครั้งแรก (ใช้ครั้งเดียว): เก็บใน Script Properties และแสดงในชีต "เริ่มต้นใช้งาน"
 * ของไฟล์ฐานข้อมูล — มีเพียงเจ้าของบัญชี Google ที่ติดตั้งระบบเท่านั้นที่เปิดดูได้
 */
function ensureSetupCode_() {
  var props = PropertiesService.getScriptProperties();
  var code = props.getProperty('SETUP_CODE');
  if (!code) {
    var alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var bytes = randomBytes_(12);
    var chars = bytes.map(function (b) { return alphabet[b % alphabet.length]; }).join('');
    code = chars.substr(0, 4) + '-' + chars.substr(4, 4) + '-' + chars.substr(8, 4);
    props.setProperty('SETUP_CODE', code);
    if (MEMO_.props) MEMO_.props.SETUP_CODE = code;
  }
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SETUP_SHEET_) || ss.insertSheet(SETUP_SHEET_);
  sh.clear();
  sh.getRange(1, 1, 7, 1).setValues([
    ["'ระบบลงเวลาปฏิบัติงานออนไลน์ โรงเรียนวัดเสาหิน — ติดตั้งครั้งแรก"],
    ["'รหัสติดตั้ง (ใช้ครั้งเดียว):"],
    ["'" + code],
    ["'1) เปิด URL ของเว็บแอป (ลงท้ายด้วย /exec)"],
    ["'2) กรอกรหัสติดตั้งด้านบน + ข้อมูลผู้ดูแลระบบ แล้วกด “เริ่มใช้งานระบบ”"],
    ["'3) เมื่อสร้างผู้ดูแลระบบสำเร็จ ชีตนี้จะถูกลบอัตโนมัติ"],
    ["'ห้ามส่งรหัสนี้ให้ผู้อื่น — ผู้ที่มีรหัสสามารถสร้างบัญชีผู้ดูแลระบบได้"]
  ]);
  sh.setColumnWidth(1, 640);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14).setFontColor('#0B2545');
  sh.getRange(3, 1).setFontWeight('bold').setFontSize(28).setFontColor('#B91C1C').setBackground('#FEF3C7');
  try { ss.setActiveSheet(sh); ss.moveActiveSheet(1); } catch (e) { /* ignore */ }
  return code;
}

function removeSetupCode_() {
  PropertiesService.getScriptProperties().deleteProperty('SETUP_CODE');
  if (MEMO_.props) delete MEMO_.props.SETUP_CODE;
  try {
    var ss = getSpreadsheet_();
    var sh = ss.getSheetByName(SETUP_SHEET_);
    if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
  } catch (e) { console.error('removeSetupCode_: ' + e); }
}

function ensureSheet_(ss, name, schema) {
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) {
    sh = ss.insertSheet(name);
    created = true;
  }
  var lastCol = sh.getLastColumn();
  var existing = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var hasHeaders = existing.some(function (h) { return h !== ''; });
  var added = [];
  if (!hasHeaders) {
    existing = [];
    lastCol = 0;
  }
  schema.cols.forEach(function (c) {
    if (existing.indexOf(c[0]) < 0) {
      added.push(c[0]);
      existing.push(c[0]);
    }
  });
  if (added.length) {
    var needCols = existing.length;
    if (sh.getMaxColumns() < needCols) sh.insertColumnsAfter(sh.getMaxColumns(), needCols - sh.getMaxColumns());
    sh.getRange(1, lastCol + 1, 1, added.length).setValues([added]);
  }
  // จัดรูปแบบหัวตาราง + คำอธิบาย (note) ภาษาไทย
  var width = existing.length;
  var header = sh.getRange(1, 1, 1, width);
  header.setFontWeight('bold').setFontColor('#FFFFFF').setBackground(schema.color || '#0B2545')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  var notes = existing.map(function (h) {
    for (var i = 0; i < schema.cols.length; i++) if (schema.cols[i][0] === h) return schema.cols[i][2];
    return '';
  });
  header.setNotes([notes]);
  sh.setFrozenRows(1);
  // หมายเหตุ: ไม่ตั้งรูปแบบคอลัมน์เป็น Plain Text (@) เพราะระบบบันทึกข้อความโดยนำหน้าด้วย ' อยู่แล้ว
  // (การใช้ทั้งสองอย่างพร้อมกัน Google Sheets อาจเก็บเครื่องหมาย ' ไว้เป็นส่วนหนึ่งของข้อความ)
  if (created) {
    for (var i = 0; i < width; i++) {
      var w = (schema.widths && schema.widths[existing[i]]) || 130;
      sh.setColumnWidth(i + 1, w);
    }
    try {
      if (['Employees', 'AttendanceLogs', 'AuditLogs', 'Sessions'].indexOf(name) >= 0) {
        sh.protect().setDescription('ข้อมูลระบบ — แก้ไขผ่านหน้าเว็บเท่านั้น').setWarningOnly(true);
      }
    } catch (e) { /* ignore */ }
  }
  return { created: created, added: created ? [] : added };
}

function removeDefaultSheet_(ss) {
  var defaults = ['Sheet1', 'ชีต1', 'แผ่นงาน1', 'แผ่น1'];
  ss.getSheets().forEach(function (sh) {
    if (defaults.indexOf(sh.getName()) >= 0 && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  });
}

function ensureDefaultSettings_() {
  var sh = MEMO_.ss.getSheetByName('Settings');
  var last = sh.getLastRow();
  var keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var added = [];
  var rows = [];
  DEFAULT_SETTINGS_.forEach(function (d) {
    if (keys.indexOf(d[0]) < 0) {
      rows.push(["'" + d[0], d[1] === '' ? '' : "'" + d[1], "'" + d[2], "'" + nowStamp_(), "'SYSTEM"]);
      added.push(d[0]);
    }
  });
  if (rows.length) {
    var t = getTable_('Settings');
    var start = sh.getLastRow() + 1;
    var full = rows.map(function (r) {
      var row = new Array(t.width);
      for (var i = 0; i < t.width; i++) row[i] = '';
      row[t.idx.Key] = r[0]; row[t.idx.Value] = r[1]; row[t.idx.Description] = r[2];
      row[t.idx.UpdatedAt] = r[3]; row[t.idx.UpdatedBy] = r[4];
      return row;
    });
    ensureRows_(sh, start + full.length - 1);
    sh.getRange(start, 1, full.length, t.width).setValues(full);
  }
  return added;
}

function ensureDriveFolders_() {
  var props = PropertiesService.getScriptProperties();
  var log = [];
  function getFolder(propKey) {
    var fid = props.getProperty(propKey);
    if (!fid) return null;
    try { var f = DriveApp.getFolderById(fid); return f.isTrashed && f.isTrashed() ? null : f; } catch (e) { return null; }
  }
  var root = getFolder('DRIVE_ROOT_FOLDER_ID');
  if (!root) {
    root = DriveApp.createFolder('WatSaoHin-Attendance-Data (ห้ามแชร์สาธารณะ)');
    props.setProperty('DRIVE_ROOT_FOLDER_ID', root.getId());
    log.push('✔ สร้างโฟลเดอร์ Google Drive: ' + root.getName());
  }
  [['ATTACHMENT_FOLDER_ID', 'Attachments (เอกสารแนบใบลา-คำร้อง)'], ['EXPORT_FOLDER_ID', 'TempExports (ไฟล์รายงานชั่วคราว)']]
    .forEach(function (x) {
      if (!getFolder(x[0])) {
        var f = root.createFolder(x[1]);
        props.setProperty(x[0], f.getId());
        log.push('✔ สร้างโฟลเดอร์ย่อย: ' + x[1]);
      }
    });
  if (!log.length) log.push('• โฟลเดอร์ Google Drive พร้อมใช้งาน');
  return log;
}

function ensureTriggers_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'DailyMaintenance'; });
  if (exists) return ['• มี Trigger งานบำรุงรักษารายวันแล้ว'];
  ScriptApp.newTrigger('DailyMaintenance').timeBased().atHour(2).everyDays(1).inTimezone(APP.TZ).create();
  return ['✔ ติดตั้ง Trigger งานบำรุงรักษารายวัน (02:00 น.)'];
}

/* ========================================================================== */
/*  Daily maintenance (Trigger) — ลบพิกัด GPS ที่เกินระยะเวลาเก็บรักษา           */
/* ========================================================================== */

/**
 * งานบำรุงรักษารายวัน (เรียกโดย Time-driven Trigger)
 * งานที่ทำมีผลตามนโยบายเท่านั้น และจำกัดให้รันได้ไม่เกินชั่วโมงละ 1 ครั้ง
 */
function DailyMaintenance(e) {
  resetMemo_();
  if (!isSystemReady_()) return 'ระบบยังไม่ได้ติดตั้ง';
  var cache = CacheService.getScriptCache();
  if (cache.get('maint_lock')) return 'เพิ่งรันไปแล้ว';
  cache.put('maint_lock', '1', 3600);
  return runMaintenance_(null);
}

function runMaintenanceNow_(ctx) {
  return { message: runMaintenance_(ctx) };
}

/* ========================================================================== */
/*  สำรองฐานข้อมูล (คัดลอก Google Sheet ไว้ในโฟลเดอร์ Backups ของ Drive บัญชีระบบ)  */
/* ========================================================================== */

var BACKUP_KEEP_ = 8;          // เก็บสำเนาล่าสุดกี่ชุด
var BACKUP_EVERY_DAYS_ = 7;    // สำรองอัตโนมัติทุกกี่วัน (ทำในงานบำรุงรักษาตอนกลางคืน)

function backupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* สร้างใหม่ */ }
  }
  var root = null, rootId = props.getProperty('DRIVE_ROOT_FOLDER_ID');
  if (rootId) { try { root = DriveApp.getFolderById(rootId); } catch (e2) { root = null; } }
  var folder = (root || DriveApp).createFolder('Backups (สำรองฐานข้อมูลอัตโนมัติ)');
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  MEMO_.props = null;
  return folder;
}

/** คัดลอกฐานข้อมูลทั้งไฟล์ แล้วเก็บไว้เฉพาะ BACKUP_KEEP_ ชุดล่าสุด (ชุดเก่าย้ายไปถังขยะ) */
function backupDatabase_() {
  var ssId = scriptProps_().SPREADSHEET_ID;
  if (!ssId) throw appError_('ระบบยังไม่ได้ติดตั้งฐานข้อมูล', 'NOT_SETUP');
  var storage = driveStorageInfo_();
  if (storage && storage.percent >= 95) {
    throw appError_('พื้นที่ Google Drive ใช้ไปแล้ว ' + storage.percent + '% จึงยังไม่สำรองข้อมูล กรุณาเพิ่มพื้นที่ก่อน', 'STORAGE_FULL');
  }
  var folder = backupFolder_();
  var name = 'สำรอง ' + DB_FILE_NAME_ + ' ' + fmt_(now_(), 'yyyy-MM-dd HHmm');
  DriveApp.getFileById(ssId).makeCopy(name, folder);
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; }); // ชื่อมีวันเวลา → ใหม่สุดก่อน
  var removed = 0;
  files.slice(BACKUP_KEEP_).forEach(function (f) { try { f.setTrashed(true); removed++; } catch (e) { /* ignore */ } });
  PropertiesService.getScriptProperties().setProperty('BACKUP_LAST', nowStamp_());
  MEMO_.props = null;
  return { name: name, kept: Math.min(files.length, BACKUP_KEEP_), removed: removed };
}

function backupInfo_() {
  var last = scriptProps_().BACKUP_LAST || '';
  return { last: last, lastLabel: last ? thaiStamp_(last) : '', keep: BACKUP_KEEP_, everyDays: BACKUP_EVERY_DAYS_ };
}

/** ถึงรอบสำรองอัตโนมัติหรือยัง */
function backupDue_() {
  var last = scriptProps_().BACKUP_LAST;
  return !last || nowMs_() - stampToMs_(last) >= (BACKUP_EVERY_DAYS_ - 0.5) * 86400000;
}

function runMaintenance_(ctx) {
  var s = getSettings_();
  var cutoff = addDays_(todayStr_(), -s.gpsRetentionDays);
  var yNow = +todayStr_().substr(0, 4);
  var holidaysAdded = 0;
  try { holidaysAdded = withLock_(function () { return seedThaiHolidays_([yNow, yNow + 1]); }); } catch (eh) { console.error('seed holidays: ' + eh); }
  var purged = withLock_(function () {
    var t = getTable_('AttendanceLogs');
    var last = t.sheet.getLastRow();
    if (last < 2) return 0;
    var n = last - 1;
    var dates = t.sheet.getRange(2, t.idx.Date + 1, n, 1).getValues();
    var latR = t.sheet.getRange(2, t.idx.Latitude + 1, n, 1);
    var lngR = t.sheet.getRange(2, t.idx.Longitude + 1, n, 1);
    var lats = latR.getValues(), lngs = lngR.getValues();
    var count = 0;
    for (var i = 0; i < n; i++) {
      var d = valueFromCell_(dates[i][0], 'date');
      if (d && d < cutoff && (lats[i][0] !== '' || lngs[i][0] !== '')) {
        lats[i][0] = ''; lngs[i][0] = ''; count++;
      }
    }
    if (count) { latR.setValues(lats); lngR.setValues(lngs); markDirty_('AttendanceLogs'); }
    return count;
  });
  var cleaned = cleanupTempExports_();
  var backup = null;
  if (backupDue_()) {
    try { backup = backupDatabase_(); } catch (eb) { console.error('backup: ' + eb); backup = { error: eb.message || String(eb) }; }
  }
  var msg = 'ลบพิกัด GPS ที่เก่ากว่า ' + thaiDate_(cutoff) + ' จำนวน ' + purged + ' รายการ, ลบไฟล์รายงานชั่วคราว ' + cleaned + ' ไฟล์' +
    (holidaysAdded ? ', เพิ่มวันหยุดราชการไทย ' + holidaysAdded + ' วัน' : '') +
    (backup ? (backup.error ? ', สำรองข้อมูลไม่สำเร็จ: ' + backup.error : ', สำรองข้อมูลอัตโนมัติแล้ว') : '');
  if (purged || holidaysAdded || backup || ctx) writeAudit_(ctx, 'MAINTENANCE', 'SYSTEM', '', { gpsPurged: purged, cutoff: cutoff, tempFilesRemoved: cleaned, holidaysAdded: holidaysAdded, backup: backup });
  return msg;
}

function cleanupTempExports_() {
  var fid = scriptProps_().EXPORT_FOLDER_ID;
  if (!fid) return 0;
  var count = 0;
  try {
    var files = DriveApp.getFolderById(fid).getFiles();
    var limit = nowMs_() - 3600 * 1000;
    while (files.hasNext()) {
      var f = files.next();
      if (f.getDateCreated().getTime() < limit) { f.setTrashed(true); count++; }
    }
  } catch (e) { console.error('cleanupTempExports_: ' + e); }
  return count;
}

/* ======================================================================
 * Crypto.gs
 * ====================================================================== */
/**
 * ============================================================================
 *  Crypto.gs — ระบบเข้ารหัสสำหรับรหัสผ่าน (Password Hashing)
 *  Wat Sao Hin School Attendance System
 * ============================================================================
 *  Google Apps Script ไม่มี bcrypt / scrypt / Argon2 ให้ใช้งาน
 *  ระบบนี้จึงใช้ PBKDF2-HMAC-SHA256 (มาตรฐาน NIST SP 800-132 / RFC 8018)
 *  ที่เขียนด้วย JavaScript ล้วน (ทำงานบน V8 runtime) ร่วมกับ
 *    1) Salt แบบสุ่มเฉพาะผู้ใช้แต่ละคน (128 บิต)
 *    2) Pepper (กุญแจลับ) ที่เก็บใน Script Properties แยกจาก Google Sheets
 *       → แม้ไฟล์ Google Sheets รั่วไหล ก็ไม่สามารถถอดรหัสผ่านแบบออฟไลน์ได้
 *    3) จำนวนรอบ (iterations) บันทึกไว้ในแต่ละ hash → ปรับเพิ่มภายหลังได้
 *       และระบบจะ re-hash อัตโนมัติเมื่อผู้ใช้เข้าสู่ระบบครั้งถัดไป
 *
 *  รูปแบบ hash ที่จัดเก็บ:
 *    pbkdf2_sha256$<iterations>$<salt base64>$<hash base64>
 *
 *  ฟังก์ชันทั้งหมดในไฟล์นี้ลงท้ายด้วย "_" (private) → ฝั่ง Browser
 *  ไม่สามารถเรียกผ่าน google.script.run ได้
 * ============================================================================
 */

var CRYPTO_ = {
  DEFAULT_ITERATIONS: 100000,
  MIN_ITERATIONS: 20000,
  HASH_PREFIX: 'pbkdf2_sha256'
};

var SHA256_K_ = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

var SHA256_IV_ = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** ประมวลผล 1 block (16 words) ลงใน state (8 words) — แก้ไข state โดยตรง */
function sha256Block_(state, block, w) {
  var K = SHA256_K_;
  var i, s0, s1, t1, t2;
  for (i = 0; i < 16; i++) w[i] = block[i] | 0;
  for (i = 16; i < 64; i++) {
    var x = w[i - 15], y = w[i - 2];
    s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  var a = state[0], b = state[1], c = state[2], d = state[3],
      e = state[4], f = state[5], g = state[6], h = state[7];
  for (i = 0; i < 64; i++) {
    s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
}

/** SHA-256 ของ byte array (0..255) → byte array 32 ไบต์ */
function sha256Bytes_(bytes) {
  var len = bytes.length;
  var bitLenHi = Math.floor(len / 0x20000000), bitLenLo = (len * 8) >>> 0;
  var total = ((len + 9 + 63) >> 6) << 6;
  var padded = new Array(total);
  var i;
  for (i = 0; i < len; i++) padded[i] = bytes[i] & 0xff;
  padded[len] = 0x80;
  for (i = len + 1; i < total; i++) padded[i] = 0;
  padded[total - 8] = (bitLenHi >>> 24) & 0xff; padded[total - 7] = (bitLenHi >>> 16) & 0xff;
  padded[total - 6] = (bitLenHi >>> 8) & 0xff; padded[total - 5] = bitLenHi & 0xff;
  padded[total - 4] = (bitLenLo >>> 24) & 0xff; padded[total - 3] = (bitLenLo >>> 16) & 0xff;
  padded[total - 2] = (bitLenLo >>> 8) & 0xff; padded[total - 1] = bitLenLo & 0xff;
  var state = SHA256_IV_.slice(), w = new Array(64), block = new Array(16);
  for (var off = 0; off < total; off += 64) {
    for (i = 0; i < 16; i++) {
      var p = off + i * 4;
      block[i] = (padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3];
    }
    sha256Block_(state, block, w);
  }
  return wordsToBytes_(state);
}

function wordsToBytes_(words) {
  var out = new Array(words.length * 4);
  for (var i = 0; i < words.length; i++) {
    out[i * 4] = (words[i] >>> 24) & 0xff; out[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 8) & 0xff; out[i * 4 + 3] = words[i] & 0xff;
  }
  return out;
}

/** HMAC-SHA256(key, message) แบบทั่วไป (byte arrays) */
function hmacSha256Bytes_(key, msg) {
  if (key.length > 64) key = sha256Bytes_(key);
  var ipad = new Array(64), opad = new Array(64);
  for (var i = 0; i < 64; i++) {
    var k = i < key.length ? key[i] & 0xff : 0;
    ipad[i] = k ^ 0x36; opad[i] = k ^ 0x5c;
  }
  var inner = sha256Bytes_(ipad.concat(msg));
  return sha256Bytes_(opad.concat(inner));
}

/** เตรียม state ของ HMAC (หลังประมวลผล key^ipad และ key^opad) เพื่อความเร็วของ PBKDF2 */
function hmacPrecompute_(key) {
  if (key.length > 64) key = sha256Bytes_(key);
  var w = new Array(64), ib = new Array(16), ob = new Array(16);
  for (var i = 0; i < 16; i++) {
    var v = 0, u = 0;
    for (var j = 0; j < 4; j++) {
      var idx = i * 4 + j;
      var k = idx < key.length ? key[idx] & 0xff : 0;
      v = (v << 8) | (k ^ 0x36);
      u = (u << 8) | (k ^ 0x5c);
    }
    ib[i] = v; ob[i] = u;
  }
  var inner = SHA256_IV_.slice(), outer = SHA256_IV_.slice();
  sha256Block_(inner, ib, w);
  sha256Block_(outer, ob, w);
  return { inner: inner, outer: outer };
}

/**
 * PBKDF2-HMAC-SHA256 (dkLen = 32 ไบต์)
 * @param {number[]} password bytes
 * @param {number[]} salt bytes
 * @param {number} iterations
 * @return {number[]} 32-byte derived key
 */
function pbkdf2Sha256_(password, salt, iterations) {
  var pre = hmacPrecompute_(password);
  // U1 = HMAC(P, S || INT_32_BE(1)) — คำนวณแบบทั่วไปเพราะความยาว salt ไม่คงที่
  var u = hmacSha256Bytes_(password, salt.concat([0, 0, 0, 1]));
  var uw = new Int32Array(8), t = new Int32Array(8), i;
  for (i = 0; i < 8; i++) {
    uw[i] = (u[i * 4] << 24) | (u[i * 4 + 1] << 16) | (u[i * 4 + 2] << 8) | u[i * 4 + 3];
    t[i] = uw[i];
  }
  // block ข้อความ 32 ไบต์ + padding ความยาว (64 + 32) * 8 = 768 บิต
  var block = new Int32Array(16), w = new Int32Array(64), st = new Int32Array(8);
  var pin = new Int32Array(pre.inner), pout = new Int32Array(pre.outer);
  for (var n = 1; n < iterations; n++) {
    // inner hash
    for (i = 0; i < 8; i++) { block[i] = uw[i]; st[i] = pin[i]; }
    block[8] = 0x80000000; block[9] = 0; block[10] = 0; block[11] = 0;
    block[12] = 0; block[13] = 0; block[14] = 0; block[15] = 768;
    sha256Block_(st, block, w);
    // outer hash
    for (i = 0; i < 8; i++) { block[i] = st[i]; st[i] = pout[i]; }
    block[8] = 0x80000000; block[15] = 768;
    sha256Block_(st, block, w);
    for (i = 0; i < 8; i++) { uw[i] = st[i]; t[i] ^= st[i]; }
  }
  return wordsToBytes_(Array.prototype.slice.call(t));
}

/** แปลงสตริงเป็น UTF-8 bytes (รองรับภาษาไทย) */
function utf8Bytes_(str) {
  var s = unescape(encodeURIComponent(String(str)));
  var out = new Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function bytesToHex_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function hexToBytes_(hex) {
  var out = [];
  for (var i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
}

function bytesToB64_(bytes) {
  return Utilities.base64Encode(bytes.map(function (b) { return b > 127 ? b - 256 : b; }));
}

function b64ToBytes_(b64) {
  return Utilities.base64Decode(b64).map(function (b) { return b & 0xff; });
}

/** SHA-256 ของสตริง → hex (ใช้บริการ native ของ Apps Script เพื่อความเร็ว) */
function sha256Hex_(str) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  return bytesToHex_(digest);
}

/**
 * สร้าง byte สุ่มด้วย Utilities.getUuid() (Java UUID.randomUUID ใช้ SecureRandom)
 * UUID v4 มีบิตสุ่ม 122 บิต → นำหลาย UUID มาผ่าน SHA-256 เพื่อกระจายบิต
 */
function randomBytes_(n) {
  var out = [];
  while (out.length < n) {
    var seed = Utilities.getUuid() + Utilities.getUuid() + ':' + Date.now() + ':' + Math.random();
    out = out.concat(sha256Bytes_(utf8Bytes_(seed)));
  }
  return out.slice(0, n);
}

function randomHex_(nBytes) {
  return bytesToHex_(randomBytes_(nBytes));
}

/** เปรียบเทียบแบบ constant-time ป้องกัน timing attack */
function constantTimeEquals_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

/** อ่าน pepper จาก Script Properties (สร้างโดย SetupSystem) */
function getPepper_() {
  var p = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
  if (!p || p.length < 32) {
    throw appError_('ระบบยังไม่ได้ติดตั้งกุญแจเข้ารหัส กรุณาให้ผู้ดูแลระบบรันฟังก์ชัน SetupSystem()', 'NOT_SETUP');
  }
  return p;
}

function getConfiguredIterations_() {
  var v = parseInt(PropertiesService.getScriptProperties().getProperty('PBKDF2_ITERATIONS'), 10);
  if (!isFinite(v) || v < CRYPTO_.MIN_ITERATIONS) v = CRYPTO_.DEFAULT_ITERATIONS;
  return Math.min(v, 1000000);
}

/** ผสม pepper ด้วย HMAC ก่อนเข้าสู่ PBKDF2 */
function pepperedPassword_(password) {
  return hmacSha256Bytes_(utf8Bytes_(getPepper_()), utf8Bytes_(password));
}

/** สร้าง hash สำหรับจัดเก็บ */
function hashPassword_(password, iterations) {
  iterations = iterations || getConfiguredIterations_();
  var salt = randomBytes_(16);
  var dk = pbkdf2Sha256_(pepperedPassword_(password), salt, iterations);
  return [CRYPTO_.HASH_PREFIX, iterations, bytesToB64_(salt), bytesToB64_(dk)].join('$');
}

/**
 * ตรวจสอบรหัสผ่านกับ hash ที่จัดเก็บ
 * @return {{ok: boolean, needsRehash: boolean}}
 */
function verifyPassword_(password, stored) {
  var parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== CRYPTO_.HASH_PREFIX) return { ok: false, needsRehash: false };
  var iterations = parseInt(parts[1], 10);
  if (!isFinite(iterations) || iterations < 1000 || iterations > 2000000) return { ok: false, needsRehash: false };
  var salt = b64ToBytes_(parts[2]);
  var dk = pbkdf2Sha256_(pepperedPassword_(password), salt, iterations);
  var ok = constantTimeEquals_(bytesToB64_(dk), parts[3]);
  return { ok: ok, needsRehash: ok && iterations !== getConfiguredIterations_() };
}

/** ทำงานเท่ากับการตรวจรหัสผ่านจริง (ใช้เมื่อไม่พบชื่อผู้ใช้ เพื่อป้องกันการเดาชื่อผู้ใช้จากเวลาตอบสนอง) */
function dummyPasswordWork_() {
  pbkdf2Sha256_(utf8Bytes_('dummy-password'), randomBytes_(16), getConfiguredIterations_());
}

/** สร้างรหัสผ่านชั่วคราวแบบสุ่ม (ตัด 0/O/1/l/I ที่สับสนออก) */
function generateTempPassword_(length) {
  length = length || 12;
  var upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnpqrstuvwxyz', digits = '23456789';
  var all = upper + lower + digits;
  var bytes = randomBytes_(length * 2);
  var chars = [upper[bytes[0] % upper.length], lower[bytes[1] % lower.length], digits[bytes[2] % digits.length]];
  for (var i = 3; i < length; i++) chars.push(all[bytes[i] % all.length]);
  // สลับตำแหน่ง (Fisher–Yates)
  for (var j = chars.length - 1; j > 0; j--) {
    var r = bytes[length + j] % (j + 1);
    var tmp = chars[j]; chars[j] = chars[r]; chars[r] = tmp;
  }
  return chars.join('');
}

/* ======================================================================
 * Auth.gs
 * ====================================================================== */
/**
 * ============================================================================
 *  Auth.gs — สมัครสมาชิก, เข้าสู่ระบบ, Session, เปลี่ยนรหัสผ่าน, สร้าง Admin คนแรก
 * ============================================================================
 *  Session:
 *   - token สุ่ม 256 บิต ส่งให้ Browser (เก็บใน sessionStorage)
 *   - Server เก็บเฉพาะ SHA-256(token) เป็นคีย์ใน CacheService (ไม่เก็บ token จริง)
 *   - หมดอายุเมื่อไม่ได้ใช้งานตาม SESSION_TIMEOUT_MIN (sliding) และไม่เกิน 12 ชั่วโมง
 *   - ทุกคำขอจะตรวจสถานะบัญชี/สิทธิ์/SessionVersion ล่าสุดจากฐานข้อมูล
 *     → ปิดใช้งานบัญชี/รีเซ็ตรหัสผ่าน มีผลทันที
 * ============================================================================
 */

var AUTH_ = {
  USERNAME_RE: /^[a-z][a-z0-9._-]{3,29}$/,
  STAFFCODE_RE: /^[A-Z0-9][A-Z0-9.\/-]{0,19}$/,
  MAX_SESSION_HOURS: 12,
  REGISTER_PER_HOUR: 30,
  MAX_PENDING: 100
};

var COMMON_PASSWORDS_ = [
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'qwerty12', 'qwerty123', 'qwertyuiop', 'asdf1234', 'asdfghjkl', 'zaq12wsx', '1q2w3e4r', '1qaz2wsx',
  'abc12345', 'abcd1234', 'aa123456', 'a1234567', 'admin123', 'admin1234', 'welcome1', 'iloveyou1',
  'school123', 'teacher1', 'teacher123', 'thailand1', 'chiangmai1', 'saohin123', 'watsaohin1'
];

/* ========================================================================== */
/*  Validation                                                                */
/* ========================================================================== */

function normalizeUsername_(u) {
  return String(u === null || u === undefined ? '' : u).trim().toLowerCase();
}

function normalizeStaffCode_(c) {
  return cleanLine_(c, 40).toUpperCase().replace(/\s+/g, '');
}

/** คืนข้อความข้อผิดพลาด หรือ '' ถ้ารหัสผ่านผ่านเกณฑ์ */
function passwordPolicyError_(pw, username) {
  if (typeof pw !== 'string') return 'กรุณากรอกรหัสผ่าน';
  if (pw.length < 8) return 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
  if (pw.length > 64) return 'รหัสผ่านต้องยาวไม่เกิน 64 ตัวอักษร';
  if (pw !== pw.trim()) return 'รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'รหัสผ่านต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข';
  if (/^(.)\1+$/.test(pw)) return 'รหัสผ่านต้องไม่ใช่ตัวอักษรเดียวกันทั้งหมด';
  if (COMMON_PASSWORDS_.indexOf(pw.toLowerCase()) >= 0) return 'รหัสผ่านนี้คาดเดาง่ายเกินไป กรุณาตั้งรหัสผ่านใหม่';
  if (username && username.length >= 4 && pw.toLowerCase().indexOf(username.toLowerCase()) >= 0) {
    return 'รหัสผ่านต้องไม่มีชื่อผู้ใช้เป็นส่วนประกอบ';
  }
  return '';
}

/**
 * ตรวจสอบข้อมูลบุคลากร (ใช้ทั้งสมัครเองและ Admin เพิ่ม/แก้ไข)
 * @return {{fullName, staffCode, position, username, password}}
 */
function validateEmployeeInput_(src, opts) {
  opts = opts || {};
  src = src || {};
  var fullName = cleanLine_(src.fullName, 200);
  if (fullName.length < 4 || fullName.length > 100) throw appError_('กรุณากรอกชื่อ-นามสกุล (4–100 ตัวอักษร)', 'VALIDATION', { field: 'fullName' });
  if (fullName.indexOf(' ') < 0) throw appError_('กรุณากรอกทั้งชื่อและนามสกุล โดยเว้นวรรคระหว่างชื่อกับนามสกุล', 'VALIDATION', { field: 'fullName' });
  if (/[<>{}\[\]=@#$%^*|\\~`"]/.test(fullName) || /\d/.test(fullName)) {
    throw appError_('ชื่อ-นามสกุลมีอักขระที่ไม่อนุญาต', 'VALIDATION', { field: 'fullName' });
  }
  var staffCode = normalizeStaffCode_(src.staffCode);
  // opts.autoCode: เว้นว่างได้ — ระบบกำหนดรหัสให้ (T001, T002, …) ภายใต้ Lock ด้วย nextStaffCode_()
  if (!(opts.autoCode && staffCode === '') && !AUTH_.STAFFCODE_RE.test(staffCode)) {
    throw appError_('รหัสประจำตัวบุคลากรต้องเป็นตัวอักษรภาษาอังกฤษ/ตัวเลข 1–20 ตัว (ใช้ - . / ได้)', 'VALIDATION', { field: 'staffCode' });
  }
  var position = cleanLine_(src.position, 60);
  if (POSITIONS.indexOf(position) < 0) throw appError_('กรุณาเลือกตำแหน่ง', 'VALIDATION', { field: 'position' });
  var username = normalizeUsername_(src.username);
  if (!AUTH_.USERNAME_RE.test(username)) {
    throw appError_('ชื่อผู้ใช้ต้องขึ้นต้นด้วยตัวอักษรภาษาอังกฤษ ยาว 4–30 ตัว ใช้ได้เฉพาะ a-z 0-9 . _ -', 'VALIDATION', { field: 'username' });
  }
  var out = { fullName: fullName, staffCode: staffCode, position: position, username: username };
  if (opts.requirePassword) {
    var err = passwordPolicyError_(src.password, username);
    if (err) throw appError_(err, 'VALIDATION', { field: 'password' });
    if (src.password !== src.confirmPassword) throw appError_('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน', 'VALIDATION', { field: 'confirmPassword' });
    out.password = src.password;
  }
  return out;
}

/**
 * รหัสประจำตัวบุคลากรถัดไปแบบอัตโนมัติ: T + เลข 3 หลักขึ้นไป (T001, T002, …) ต่อจากเลขที่มากที่สุดในระบบ
 * @param {Object=} taken รหัสที่ถูกจองเพิ่มเติม (เช่น ระหว่างเพิ่มหลายคน) — จะถูกเพิ่มรหัสใหม่เข้าไปด้วย
 */
function nextStaffCode_(taken) {
  var max = 0;
  var scan = function (code) { var m = /^T(\d{1,6})$/.exec(normalizeStaffCode_(code)); if (m) max = Math.max(max, parseInt(m[1], 10)); };
  readAll_('Employees').forEach(function (e) { scan(e.StaffCode); });
  if (taken) Object.keys(taken).forEach(scan);
  var n = max + 1, code = 'T' + (n < 1000 ? ('00' + n).slice(-3) : String(n));
  if (taken) taken[code] = true;
  return code;
}

/** ตรวจสอบ Username และรหัสบุคลากรซ้ำ (อ่านจากชีตโดยตรง — เรียกภายใต้ Lock) */
function assertUniqueEmployee_(username, staffCode, excludeId) {
  var rows = readAll_('Employees');
  for (var i = 0; i < rows.length; i++) {
    var e = rows[i];
    if (excludeId && e.EmployeeID === excludeId) continue;
    if (normalizeUsername_(e.Username) === username) {
      throw appError_('ชื่อผู้ใช้ "' + username + '" ถูกใช้งานแล้ว กรุณาเลือกชื่อผู้ใช้อื่น', 'DUPLICATE', { field: 'username' });
    }
    if (normalizeStaffCode_(e.StaffCode) === staffCode) {
      throw appError_('รหัสประจำตัวบุคลากร "' + staffCode + '" มีในระบบแล้ว หากเป็นของท่านกรุณาติดต่อผู้ดูแลระบบ', 'DUPLICATE', { field: 'staffCode' });
    }
  }
}

/* ========================================================================== */
/*  Registration (public)                                                     */
/* ========================================================================== */

/** สมัครสมาชิก (เรียกจากหน้า Register) — สถานะเริ่มต้น PENDING */
function register(form) {
  resetMemo_();
  try {
    ensureReady_();
    var s = getSettings_();
    if (!s.allowRegistration) throw appError_('ขณะนี้ระบบปิดรับสมัครสมาชิก กรุณาติดต่อผู้ดูแลระบบ', 'CLOSED');
    form = sanitizeParams_(form);
    var data = validateEmployeeInput_(form, { requirePassword: true, autoCode: true });
    if (form.acceptPrivacy !== true) {
      throw appError_('กรุณายอมรับนโยบายการเก็บข้อมูลตำแหน่ง (GPS) และข้อมูลส่วนบุคคล', 'VALIDATION', { field: 'acceptPrivacy' });
    }
    // จำกัดจำนวนการสมัครต่อชั่วโมง ป้องกันการสแปม
    var cache = CacheService.getScriptCache();
    var rateKey = 'reg_rate_' + fmt_(now_(), 'yyyyMMddHH');
    var count = parseInt(cache.get(rateKey) || '0', 10);
    if (count >= AUTH_.REGISTER_PER_HOUR) throw appError_('มีการสมัครสมาชิกจำนวนมากในขณะนี้ กรุณาลองใหม่ภายหลัง', 'BUSY');

    var hash = hashPassword_(data.password); // คำนวณนอก Lock (ใช้ CPU)
    var emp = withLock_(function () {
      if (!data.staffCode) data.staffCode = nextStaffCode_();
      assertUniqueEmployee_(data.username, data.staffCode, null);
      var pending = readAll_('Employees').filter(function (e) { return e.Status === EMP_STATUS.PENDING; }).length;
      if (pending >= AUTH_.MAX_PENDING) throw appError_('มีผู้สมัครรออนุมัติจำนวนมาก กรุณาติดต่อผู้ดูแลระบบ', 'BUSY');
      var rec = {
        EmployeeID: newId_('EMP'),
        StaffCode: data.staffCode,
        FullName: data.fullName,
        Position: data.position,
        Username: data.username,
        PasswordHash: hash,
        Role: ROLES.USER,
        Status: EMP_STATUS.PENDING,
        MustChangePassword: false,
        SessionVersion: 1,
        ActiveFrom: '',
        CreatedAt: nowStamp_(),
        CreatedBy: 'SELF',
        UpdatedAt: nowStamp_(),
        ApprovedBy: '', ApprovedAt: '', LastLoginAt: '', Note: ''
      };
      appendRecord_('Employees', rec);
      return rec;
    });
    cache.put(rateKey, String(count + 1), 3700);
    writeAudit_(null, 'REGISTER', 'Employee', emp.EmployeeID, {
      username: emp.Username, staffCode: emp.StaffCode, fullName: emp.FullName, position: emp.Position
    });
    return {
      ok: true,
      data: {
        reference: emp.EmployeeID,
        fullName: emp.FullName,
        username: emp.Username,
        staffCode: emp.StaffCode,
        message: 'สมัครสมาชิกสำเร็จ บัญชีของท่านอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ ' +
          'เมื่อได้รับอนุมัติแล้วจึงจะสามารถเข้าสู่ระบบและลงเวลาได้'
      }
    };
  } catch (err) {
    return toErrorResponse_(err, 'register');
  }
}

/* ========================================================================== */
/*  Login (public)                                                            */
/* ========================================================================== */

function loginFailKey_(username) { return 'lf_' + sha256Hex_('login:' + username).substr(0, 40); }

function getLoginState_(username) {
  var raw = CacheService.getScriptCache().get(loginFailKey_(username));
  if (!raw) return { count: 0, lockedUntil: 0 };
  try { return JSON.parse(raw); } catch (e) { return { count: 0, lockedUntil: 0 }; }
}

function registerLoginFailure_(username, settings) {
  var st = getLoginState_(username);
  st.count = (st.count || 0) + 1;
  var ttl = settings.lockoutMin * 60;
  if (st.count >= settings.maxLoginAttempts) {
    st.lockedUntil = nowMs_() + settings.lockoutMin * 60000;
    writeAudit_(null, 'LOGIN_LOCKED', 'Username', username, { attempts: st.count, minutes: settings.lockoutMin });
  }
  CacheService.getScriptCache().put(loginFailKey_(username), JSON.stringify(st), Math.max(60, ttl));
  return st;
}

function clearLoginFailures_(username) {
  CacheService.getScriptCache().remove(loginFailKey_(username));
}

/**
 * เข้าสู่ระบบด้วย Username + Password
 * @param {string} username
 * @param {string} password
 * @param {Object} clientInfo {ua}
 */
function login(username, password, clientInfo) {
  resetMemo_();
  try {
    ensureReady_();
    var uname = normalizeUsername_(username);
    if (!uname || typeof password !== 'string' || !password) throw appError_('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'VALIDATION');
    if (uname.length > 60 || password.length > 128) throw appError_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'INVALID_LOGIN');
    var s = getSettings_();
    // เข้าสู่ระบบด้วย "ชื่อผู้ใช้" หรือ "รหัสประจำตัวบุคลากร" (เช่น T005) ก็ได้ — นับครั้งที่ผิดตามบัญชีเดียวกัน
    var emp = findOne_('Employees', 'Username', uname);
    if (!emp) {
      var code = normalizeStaffCode_(username);
      if (code) emp = readAll_('Employees').filter(function (e) { return normalizeStaffCode_(e.StaffCode) === code; })[0] || null;
      if (emp) uname = normalizeUsername_(emp.Username);
    }
    var st = getLoginState_(uname);
    if (st.lockedUntil && st.lockedUntil > nowMs_()) {
      var mins = Math.ceil((st.lockedUntil - nowMs_()) / 60000);
      throw appError_('บัญชีถูกล็อกชั่วคราวเนื่องจากใส่รหัสผ่านผิดเกินกำหนด กรุณาลองใหม่ในอีก ' + mins +
        ' นาที หรือติดต่อผู้ดูแลระบบ', 'LOCKED');
    }
    var verified = null;
    if (!emp) {
      dummyPasswordWork_(); // ใช้เวลาเท่ากัน ป้องกันการเดาชื่อผู้ใช้จากเวลาตอบสนอง
    } else {
      verified = verifyPassword_(password, emp.PasswordHash);
    }
    if (!emp || !verified.ok) {
      var f = registerLoginFailure_(uname, s);
      var left = s.maxLoginAttempts - f.count;
      throw appError_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' +
        (left > 0 ? ' (เหลือโอกาสอีก ' + left + ' ครั้ง)' : ' — บัญชีถูกล็อกชั่วคราว ' + s.lockoutMin + ' นาที'),
        left > 0 ? 'INVALID_LOGIN' : 'LOCKED');
    }
    clearLoginFailures_(uname);
    if (emp.Status === EMP_STATUS.PENDING) throw appError_('บัญชีของท่านอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ', 'PENDING');
    if (emp.Status === EMP_STATUS.REJECTED) throw appError_('การสมัครสมาชิกของท่านไม่ได้รับการอนุมัติ กรุณาติดต่อผู้ดูแลระบบ', 'REJECTED');
    if (emp.Status !== EMP_STATUS.ACTIVE) throw appError_('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 'INACTIVE');

    var newHash = verified.needsRehash ? hashPassword_(password) : null;
    emp = withLock_(function () {
      var patch = { LastLoginAt: nowStamp_() };
      if (newHash) patch.PasswordHash = newHash;
      return updateById_('Employees', 'EmployeeID', emp.EmployeeID, patch);
    });
    var remember = !!(clientInfo && typeof clientInfo === 'object' && clientInfo.remember) && s.rememberDays > 0;
    var sess = createSessionEx_(emp, clientInfo, { remember: remember });
    writeAudit_({ user: emp }, 'LOGIN', 'Employee', emp.EmployeeID, { rehashed: !!newHash, remember: remember });
    return { ok: true, data: sessionPayload_(emp, sess, s) };
  } catch (err) {
    return toErrorResponse_(err, 'login');
  }
}

/* ========================================================================== */
/*  ลืมรหัสผ่าน: ส่งคำขอให้ผู้ดูแลระบบรีเซ็ต (public)                          */
/* ========================================================================== */

/**
 * บุคลากรที่ลืมรหัสผ่านส่งคำขอด้วย "ชื่อผู้ใช้" หรือ "รหัสประจำตัวบุคลากร"
 * - ตอบข้อความเดียวกันเสมอ ไม่ว่าจะพบบัญชีหรือไม่ (ป้องกันการเดาชื่อผู้ใช้)
 * - ไม่เปลี่ยนรหัสผ่านใด ๆ: ผู้ดูแลระบบต้องยืนยันตัวตนแล้วกด "รีเซ็ตรหัสผ่าน" เอง
 * - จำกัดความถี่: บัญชีละ 1 ครั้ง/10 นาที และรวมทั้งระบบไม่เกิน 60 ครั้ง/ชั่วโมง
 */
function requestPasswordReset(form) {
  resetMemo_();
  var generic = {
    ok: true,
    data: {
      message: 'ส่งคำขอแล้ว หากข้อมูลตรงกับบัญชีในระบบ ผู้ดูแลระบบจะเห็นคำขอของท่าน ' +
        'กรุณาติดต่อผู้ดูแลระบบเพื่อยืนยันตัวตนและรับรหัสผ่านชั่วคราว'
    }
  };
  try {
    ensureReady_();
    form = sanitizeParams_(form);
    var ident = cleanLine_(form.identifier, 60);
    if (ident.length < 1) throw appError_('กรุณากรอกชื่อผู้ใช้ หรือรหัสประจำตัวบุคลากร', 'VALIDATION', { field: 'identifier' });
    var note = cleanLine_(form.note, 200);
    var cache = CacheService.getScriptCache();
    var hourKey = 'pwreq_' + fmt_(now_(), 'yyyyMMddHH');
    var hourCount = parseInt(cache.get(hourKey) || '0', 10);
    if (hourCount >= 60) throw appError_('มีคำขอจำนวนมากในขณะนี้ กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแลระบบโดยตรง', 'BUSY');
    cache.put(hourKey, String(hourCount + 1), 3700);

    var uname = normalizeUsername_(ident), code = normalizeStaffCode_(ident);
    var emp = getEmployees_().filter(function (e) {
      return e.Status === EMP_STATUS.ACTIVE && (normalizeUsername_(e.Username) === uname || normalizeStaffCode_(e.StaffCode) === code);
    })[0];
    if (!emp) return generic; // ไม่บอกว่าไม่พบบัญชี
    var accKey = 'pwreq_acc_' + emp.EmployeeID;
    if (cache.get(accKey)) return generic; // ส่งซ้ำถี่เกินไป: ไม่บันทึกเพิ่ม
    cache.put(accKey, '1', 600);
    withLock_(function () {
      updateById_('Employees', 'EmployeeID', emp.EmployeeID, { ResetRequestedAt: nowStamp_(), ResetRequestNote: note });
    });
    writeAudit_(null, 'PASSWORD_RESET_REQUEST', 'Employee', emp.EmployeeID, { fullName: emp.FullName, note: note });
    return generic;
  } catch (err) {
    return toErrorResponse_(err, 'requestPasswordReset');
  }
}

/* ========================================================================== */
/*  Sessions                                                                  */
/* ========================================================================== */

function sessionKey_(token) { return 'sess_' + sha256Hex_('session:' + token); }
function deviceKeyHash_(secret) { return sha256Hex_('device:' + secret); }

/** เก็บ Session ใน CacheService → token (ref = รหัสอ้างอิงแถวในชีต Sessions) */
function putCacheSession_(emp, ref) {
  var token = randomHex_(32);
  var sess = { uid: emp.EmployeeID, sv: Number(emp.SessionVersion) || 0, iat: nowMs_(), ref: ref || sessionKey_(token).substr(5, 16) };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(sess), getSettings_().sessionTimeoutMin * 60);
  return { token: token, ref: sess.ref };
}

/**
 * สร้าง Session ใหม่ + บันทึกประวัติในชีต Sessions
 * opts.remember = จดจำการเข้าสู่ระบบบนอุปกรณ์นี้ → คืน device token (ref.secret) ให้ Browser เก็บไว้
 * Server เก็บเฉพาะ SHA-256 ของ secret
 */
function createSessionEx_(emp, clientInfo, opts) {
  var s = getSettings_();
  var c = putCacheSession_(emp, null);
  var ua = clientInfo && typeof clientInfo === 'object' ? cleanLine_(clientInfo.ua, 250) : '';
  var rec = {
    SessionRef: c.ref, EmployeeID: emp.EmployeeID, Username: emp.Username,
    LoginAt: nowStamp_(), LogoutAt: '', EndReason: '', UserAgent: ua,
    RememberUntil: '', DeviceKeyHash: '', SessionVersion: Number(emp.SessionVersion) || 0, LastSeenAt: ''
  };
  var device = null;
  if (opts && opts.remember && s.rememberDays > 0) {
    var secret = randomHex_(32);
    rec.DeviceKeyHash = deviceKeyHash_(secret);
    rec.RememberUntil = msToStamp_(nowMs_() + s.rememberDays * 86400000);
    device = c.ref + '.' + secret;
  }
  appendRecord_('Sessions', rec);
  return { token: c.token, device: device };
}

function createSession_(emp, clientInfo) { return createSessionEx_(emp, clientInfo, null).token; }

function sessionPayload_(emp, sess, s) {
  return {
    token: sess.token,
    device: sess.device || null,
    user: publicUser_(emp),
    mustChangePassword: !!emp.MustChangePassword,
    sessionTimeoutMin: s.sessionTimeoutMin
  };
}

function stampToMs_(stamp) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(stamp || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +m[6]); // Asia/Bangkok = UTC+7 (ไม่มีเวลาออมแสง)
}
function msToStamp_(ms) { return fmt_(new Date(ms), 'yyyy-MM-dd HH:mm:ss'); }

/** อายุสูงสุดของการจดจำอุปกรณ์นับจากการเข้าสู่ระบบด้วยรหัสผ่าน (วัน) */
var REMEMBER_MAX_DAYS_ = 180;

/**
 * เข้าสู่ระบบอัตโนมัติบน "อุปกรณ์ที่จดจำไว้" (ฟังก์ชันสาธารณะ — ไม่ต้องกรอกรหัสผ่าน)
 * ใช้ไม่ได้เมื่อ: ออกจากระบบ, เปลี่ยน/รีเซ็ตรหัสผ่าน, ออกจากระบบทุกอุปกรณ์, บัญชีถูกปิด,
 *               ไม่ได้ใช้งานเกิน REMEMBER_DEVICE_DAYS วัน หรือเกิน 180 วันนับจากเข้าสู่ระบบด้วยรหัสผ่าน
 * @param {string} deviceToken 'ref(16 hex).secret(64 hex)'
 */
function resumeSession(deviceToken, clientInfo) {
  resetMemo_();
  try {
    ensureReady_();
    var m = /^([a-f0-9]{16})\.([a-f0-9]{64})$/.exec(String(deviceToken || ''));
    if (!m) throw appError_('กรุณาเข้าสู่ระบบ', 'AUTH');
    var cache = CacheService.getScriptCache();
    var failKey = 'resume_fail_' + fmt_(now_(), 'yyyyMMddHH');
    var fails = parseInt(cache.get(failKey) || '0', 10);
    if (fails >= 300) throw appError_('กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน', 'AUTH');
    var expired = function () {
      cache.put(failKey, String(fails + 1), 3700);
      return appError_('การจดจำเครื่องนี้สิ้นสุดแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านอีกครั้ง', 'AUTH');
    };
    var s = getSettings_();
    if (!s.rememberDays) throw expired();
    var rec = findOne_('Sessions', 'SessionRef', m[1]);
    if (!rec || !rec.DeviceKeyHash || rec.LogoutAt) throw expired();
    if (!constantTimeEquals_(String(rec.DeviceKeyHash), deviceKeyHash_(m[2]))) throw expired();
    var nowMs = nowMs_();
    var until = stampToMs_(rec.RememberUntil);
    if (!(until > nowMs)) throw expired();
    var emp = getEmployeeById_(rec.EmployeeID);
    if (!emp || emp.Status !== EMP_STATUS.ACTIVE || (Number(emp.SessionVersion) || 0) !== (Number(rec.SessionVersion) || 0)) throw expired();
    var cap = stampToMs_(rec.LoginAt) + REMEMBER_MAX_DAYS_ * 86400000;
    var nextUntil = Math.min(nowMs + s.rememberDays * 86400000, isFinite(cap) ? cap : nowMs);
    withLock_(function () {
      updateRecord_('Sessions', rec._row, { LastSeenAt: nowStamp_(), RememberUntil: msToStamp_(nextUntil) });
    });
    var c = putCacheSession_(emp, rec.SessionRef);
    writeAudit_({ user: emp }, 'LOGIN_REMEMBERED', 'Employee', emp.EmployeeID, { ref: rec.SessionRef });
    return { ok: true, data: sessionPayload_(emp, { token: c.token, device: deviceToken }, s) };
  } catch (err) {
    return toErrorResponse_(err, 'resumeSession');
  }
}

/** เปิดการจดจำอุปกรณ์ให้ Session ปัจจุบัน (ใช้หลังเปลี่ยนรหัสผ่าน หรือเลือกภายหลังจากหน้าบัญชีผู้ใช้) */
function rememberDevice_(ctx) {
  if (!ctx.settings.rememberDays) throw appError_('ผู้ดูแลระบบปิดการจดจำการเข้าสู่ระบบไว้', 'VALIDATION');
  var secret = randomHex_(32);
  var ok = withLock_(function () {
    var rec = findOne_('Sessions', 'SessionRef', ctx.sess.ref);
    if (!rec || rec.LogoutAt) return false;
    updateRecord_('Sessions', rec._row, {
      DeviceKeyHash: deviceKeyHash_(secret), SessionVersion: Number(ctx.user.SessionVersion) || 0,
      RememberUntil: msToStamp_(nowMs_() + ctx.settings.rememberDays * 86400000)
    });
    return true;
  });
  if (!ok) throw appError_('กรุณาเข้าสู่ระบบใหม่', 'AUTH');
  return { device: ctx.sess.ref + '.' + secret, days: ctx.settings.rememberDays };
}

/** ออกจากระบบทุกอุปกรณ์ (เช่น โทรศัพท์หาย) — ยกเลิกการจดจำทุกเครื่องด้วย */
function logoutAll_(ctx) {
  withLock_(function () {
    updateById_('Employees', 'EmployeeID', ctx.user.EmployeeID, {
      SessionVersion: (Number(ctx.user.SessionVersion) || 0) + 1, UpdatedAt: nowStamp_()
    });
  });
  CacheService.getScriptCache().remove(ctx.sessionKey);
  endSessionLog_(ctx.sess.ref, 'LOGOUT_ALL');
  writeAudit_(ctx, 'LOGOUT_ALL', 'Employee', ctx.user.EmployeeID, null);
  return { loggedOut: true, message: 'ออกจากระบบทุกอุปกรณ์แล้ว' };
}

/**
 * ตรวจสอบ Session ทุกคำขอ (ฝั่ง Server)
 * @return {{user: Object, sessionKey: string, sess: Object, settings: Object}}
 */
function requireSession_(token, opts) {
  opts = opts || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    throw appError_('กรุณาเข้าสู่ระบบ', 'AUTH');
  }
  // ตรวจแบบเบา (Script Properties) — หากชีตหายไป getTable_ จะแจ้ง NOT_SETUP เอง
  var props = scriptProps_();
  if (!props.PASSWORD_PEPPER || !props.SPREADSHEET_ID) throw appError_('ระบบยังไม่ได้ติดตั้ง กรุณาแจ้งผู้ดูแลระบบ', 'NOT_SETUP');
  var cache = CacheService.getScriptCache();
  var key = sessionKey_(token);
  var raw = cache.get(key);
  if (!raw) throw appError_('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่', 'AUTH');
  var sess;
  try { sess = JSON.parse(raw); } catch (e) { throw appError_('กรุณาเข้าสู่ระบบใหม่', 'AUTH'); }
  if (nowMs_() - sess.iat > AUTH_.MAX_SESSION_HOURS * 3600000) {
    cache.remove(key);
    throw appError_('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'AUTH');
  }
  var emp = getEmployeeById_(sess.uid);
  if (!emp || emp.Status !== EMP_STATUS.ACTIVE || (Number(emp.SessionVersion) || 0) !== sess.sv) {
    cache.remove(key);
    throw appError_('สิทธิ์การใช้งานของท่านมีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่', 'AUTH');
  }
  if (emp.MustChangePassword && !opts.allowMustChange) {
    throw appError_('กรุณาเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน', 'MUST_CHANGE_PASSWORD');
  }
  var settings = getSettings_();
  cache.put(key, raw, settings.sessionTimeoutMin * 60); // ต่ออายุเมื่อมีการใช้งาน
  return { user: emp, sessionKey: key, sess: sess, settings: settings };
}

function authSession_(ctx) {
  return {
    user: publicUser_(ctx.user),
    mustChangePassword: !!ctx.user.MustChangePassword,
    sessionTimeoutMin: ctx.settings.sessionTimeoutMin
  };
}

function endSessionLog_(ref, reason) {
  try {
    withLock_(function () {
      var rec = findOne_('Sessions', 'SessionRef', ref);
      if (rec && !rec.LogoutAt) updateRecord_('Sessions', rec._row, { LogoutAt: nowStamp_(), EndReason: reason });
    });
  } catch (e) { console.error('endSessionLog_: ' + e); }
}

function logout_(ctx) {
  CacheService.getScriptCache().remove(ctx.sessionKey);
  endSessionLog_(ctx.sess.ref, 'LOGOUT');
  writeAudit_(ctx, 'LOGOUT', 'Employee', ctx.user.EmployeeID, null);
  return { loggedOut: true };
}

/* ========================================================================== */
/*  Change password                                                           */
/* ========================================================================== */

function changePassword_(ctx, p) {
  var current = String(p.currentPassword || '');
  var next = String(p.newPassword || '');
  if (!current) throw appError_('กรุณากรอกรหัสผ่านปัจจุบัน', 'VALIDATION', { field: 'currentPassword' });
  var full = findOne_('Employees', 'EmployeeID', ctx.user.EmployeeID);
  if (!full) throw appError_('ไม่พบบัญชีผู้ใช้', 'AUTH');
  if (!verifyPassword_(current, full.PasswordHash).ok) {
    writeAudit_(ctx, 'PASSWORD_CHANGE_FAILED', 'Employee', full.EmployeeID, null);
    throw appError_('รหัสผ่านปัจจุบันไม่ถูกต้อง', 'VALIDATION', { field: 'currentPassword' });
  }
  var err = passwordPolicyError_(next, full.Username);
  if (err) throw appError_(err, 'VALIDATION', { field: 'newPassword' });
  if (next !== p.confirmPassword) throw appError_('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน', 'VALIDATION', { field: 'confirmPassword' });
  if (next === current) throw appError_('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม', 'VALIDATION', { field: 'newPassword' });

  var hash = hashPassword_(next);
  var updated = withLock_(function () {
    return updateById_('Employees', 'EmployeeID', full.EmployeeID, {
      PasswordHash: hash,
      MustChangePassword: false,
      SessionVersion: (Number(full.SessionVersion) || 0) + 1,
      UpdatedAt: nowStamp_()
    });
  });
  CacheService.getScriptCache().remove(ctx.sessionKey);
  endSessionLog_(ctx.sess.ref, 'PASSWORD_CHANGED');
  resetMemo_(); // ให้ getEmployees_ อ่านข้อมูลล่าสุด
  var token = createSession_(updated, { ua: '' });
  writeAudit_({ user: updated }, 'PASSWORD_CHANGED', 'Employee', updated.EmployeeID, null);
  return { token: token, user: publicUser_(updated), message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' };
}

/* ========================================================================== */
/*  Bootstrap: สร้างผู้ดูแลระบบคนแรก (รันจาก Apps Script Editor เท่านั้น)        */
/* ========================================================================== */

/**
 * สร้างผู้ดูแลระบบคนแรกจาก Script Properties:
 *   BOOTSTRAP_ADMIN_USERNAME   (จำเป็น)
 *   BOOTSTRAP_ADMIN_PASSWORD   (จำเป็น — ระบบจะลบทิ้งทันทีหลังสร้างบัญชี)
 *   BOOTSTRAP_ADMIN_FULLNAME   (จำเป็น)
 *   BOOTSTRAP_ADMIN_STAFFCODE  (ไม่บังคับ — เว้นว่าง = ระบบกำหนดให้)
 *   BOOTSTRAP_ADMIN_POSITION   (ไม่บังคับ ค่าเริ่มต้น: ครู)
 * ทำงานได้เฉพาะเมื่อยังไม่มี ADMIN ที่ใช้งานอยู่ และบังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
 */
function CreateFirstAdmin() {
  assertOwnerContext_();
  resetMemo_();
  ensureReady_();
  var props = PropertiesService.getScriptProperties();
  var hasAdmin = readAll_('Employees').some(function (e) { return e.Role === ROLES.ADMIN && e.Status === EMP_STATUS.ACTIVE; });
  if (hasAdmin) {
    throw new Error('มีผู้ดูแลระบบที่ใช้งานอยู่แล้ว หากลืมรหัสผ่าน ให้ใช้ EmergencyResetAdmin() แทน');
  }
  var input = {
    username: props.getProperty('BOOTSTRAP_ADMIN_USERNAME'),
    password: props.getProperty('BOOTSTRAP_ADMIN_PASSWORD'),
    confirmPassword: props.getProperty('BOOTSTRAP_ADMIN_PASSWORD'),
    fullName: props.getProperty('BOOTSTRAP_ADMIN_FULLNAME'),
    staffCode: props.getProperty('BOOTSTRAP_ADMIN_STAFFCODE'),
    position: props.getProperty('BOOTSTRAP_ADMIN_POSITION') || 'ครู'
  };
  if (!input.username || !input.password || !input.fullName) {
    throw new Error('กรุณาตั้งค่า Script Properties: BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD, ' +
      'BOOTSTRAP_ADMIN_FULLNAME ก่อนรันฟังก์ชันนี้');
  }
  var data;
  try {
    data = validateEmployeeInput_(input, { requirePassword: true, autoCode: true });
  } catch (e) {
    throw new Error('ข้อมูลผู้ดูแลระบบไม่ถูกต้อง: ' + e.message);
  }
  var hash = hashPassword_(data.password);
  var rec = withLock_(function () {
    if (!data.staffCode) data.staffCode = nextStaffCode_();
    assertUniqueEmployee_(data.username, data.staffCode, null);
    var r = {
      EmployeeID: newId_('EMP'), StaffCode: data.staffCode, FullName: data.fullName, Position: data.position,
      Username: data.username, PasswordHash: hash, Role: ROLES.ADMIN, Status: EMP_STATUS.ACTIVE,
      MustChangePassword: true, SessionVersion: 1, ActiveFrom: todayStr_(), CreatedAt: nowStamp_(),
      CreatedBy: 'BOOTSTRAP', UpdatedAt: nowStamp_(), ApprovedBy: 'BOOTSTRAP', ApprovedAt: nowStamp_(),
      LastLoginAt: '', Note: 'ผู้ดูแลระบบคนแรก'
    };
    appendRecord_('Employees', r);
    return r;
  });
  props.deleteProperty('BOOTSTRAP_ADMIN_PASSWORD');
  removeSetupCode_();
  writeAudit_(null, 'BOOTSTRAP_ADMIN_CREATED', 'Employee', rec.EmployeeID, { username: rec.Username });
  var msg = '✔ สร้างผู้ดูแลระบบ "' + rec.Username + '" เรียบร้อย\n' +
    '✔ ลบ BOOTSTRAP_ADMIN_PASSWORD ออกจาก Script Properties แล้ว\n' +
    '➜ เข้าสู่ระบบผ่านเว็บแอปด้วยรหัสผ่านที่ตั้งไว้ ระบบจะบังคับให้เปลี่ยนรหัสผ่านทันที';
  Logger.log(msg);
  return msg;
}

/**
 * ติดตั้งครั้งแรกผ่านหน้าเว็บ (ไม่ต้องใช้ Script Properties):
 * ผู้ติดตั้งนำ "รหัสติดตั้ง" จากชีต "เริ่มต้นใช้งาน" ในไฟล์ฐานข้อมูล (เห็นได้เฉพาะเจ้าของบัญชี Google)
 * มากรอกพร้อมข้อมูลผู้ดูแลระบบคนแรก และ (ถ้ามี) พิกัดโรงเรียน/เวลาทำงาน
 * ใช้ได้ครั้งเดียว และเฉพาะเมื่อยังไม่มีผู้ดูแลระบบ
 */
function firstRunSetup(form) {
  resetMemo_();
  try {
    ensureReady_();
    form = sanitizeParams_(form);
    var cache = CacheService.getScriptCache();
    var rateKey = 'setup_try_' + fmt_(now_(), 'yyyyMMddHH');
    var tries = parseInt(cache.get(rateKey) || '0', 10);
    if (tries >= 20) throw appError_('กรอกรหัสติดตั้งผิดหลายครั้ง กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่', 'LOCKED');
    if (hasActiveAdmin_()) throw appError_('ระบบมีผู้ดูแลระบบแล้ว กรุณาเข้าสู่ระบบตามปกติ', 'ALREADY_SETUP');
    var expected = String(scriptProps_().SETUP_CODE || '').replace(/[^A-Z0-9]/g, '');
    var given = String(form.setupCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!expected || !given || !constantTimeEquals_(given, expected)) {
      cache.put(rateKey, String(tries + 1), 3700);
      throw appError_('รหัสติดตั้งไม่ถูกต้อง กรุณาคัดลอกจากชีต "' + SETUP_SHEET_ + '" ในไฟล์ฐานข้อมูลอีกครั้ง', 'VALIDATION', { field: 'setupCode' });
    }
    var data = validateEmployeeInput_(form, { requirePassword: true, autoCode: true });
    // การตั้งค่าเริ่มต้น (ไม่บังคับ) — ปรับภายหลังได้ในหน้าตั้งค่าระบบ
    var input = form.settings || {};
    var next = {};
    ['SCHOOL_LAT', 'SCHOOL_LNG', 'WORK_START_TIME', 'LATE_AFTER_TIME', 'WORK_END_TIME'].forEach(function (k) {
      if (input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== '') next[k] = normalizeSetting_(k, input[k]);
    });
    if (input.SETTINGS_CONFIRMED === true) next.SETTINGS_CONFIRMED = 'TRUE';
    var current = getSettings_().raw;
    var merged = {};
    Object.keys(SETTING_RULES_).forEach(function (k) { merged[k] = k in next ? next[k] : String(current[k] === undefined ? '' : current[k]); });
    validateSettingRelations_(merged);

    var hash = hashPassword_(data.password);
    var emp = withLock_(function () {
      var exists = readAll_('Employees').some(function (e) { return e.Role === ROLES.ADMIN && e.Status === EMP_STATUS.ACTIVE; });
      if (exists) throw appError_('ระบบมีผู้ดูแลระบบแล้ว กรุณาเข้าสู่ระบบตามปกติ', 'ALREADY_SETUP');
      if (!data.staffCode) data.staffCode = nextStaffCode_();
      assertUniqueEmployee_(data.username, data.staffCode, null);
      var r = {
        EmployeeID: newId_('EMP'), StaffCode: data.staffCode, FullName: data.fullName, Position: data.position,
        Username: data.username, PasswordHash: hash, Role: ROLES.ADMIN, Status: EMP_STATUS.ACTIVE,
        MustChangePassword: false, SessionVersion: 1, ActiveFrom: todayStr_(), ActiveTo: '', CreatedAt: nowStamp_(),
        CreatedBy: 'FIRST_RUN', UpdatedAt: nowStamp_(), ApprovedBy: 'FIRST_RUN', ApprovedAt: nowStamp_(),
        LastLoginAt: nowStamp_(), Note: 'ผู้ดูแลระบบคนแรก (ติดตั้งผ่านหน้าเว็บ)'
      };
      appendRecord_('Employees', r);
      r.settingChanges = writeSettingValues_(next, current, r.FullName);
      return r;
    });
    removeSetupCode_();
    writeAudit_({ user: emp }, 'FIRST_RUN_SETUP', 'Employee', emp.EmployeeID, { username: emp.Username, settings: emp.settingChanges });
    resetMemo_();
    var token = createSession_(emp, form.clientInfo || {});
    return {
      ok: true,
      data: {
        token: token, user: publicUser_(emp), mustChangePassword: false,
        sessionTimeoutMin: getSettings_().sessionTimeoutMin,
        message: 'ติดตั้งระบบสำเร็จ ยินดีต้อนรับผู้ดูแลระบบ'
      }
    };
  } catch (err) {
    return toErrorResponse_(err, 'firstRunSetup');
  }
}

/**
 * กู้คืนสิทธิ์ผู้ดูแลระบบ (กรณีลืมรหัสผ่าน/ถูกปิดใช้งาน) — รันจาก Editor เท่านั้น
 * ใช้ Script Properties: BOOTSTRAP_ADMIN_USERNAME + BOOTSTRAP_ADMIN_PASSWORD (ลบทิ้งอัตโนมัติ)
 */
function EmergencyResetAdmin() {
  assertOwnerContext_();
  resetMemo_();
  ensureReady_();
  var props = PropertiesService.getScriptProperties();
  var username = normalizeUsername_(props.getProperty('BOOTSTRAP_ADMIN_USERNAME'));
  var password = props.getProperty('BOOTSTRAP_ADMIN_PASSWORD');
  if (!username || !password) throw new Error('กรุณาตั้งค่า BOOTSTRAP_ADMIN_USERNAME และ BOOTSTRAP_ADMIN_PASSWORD ก่อน');
  var err = passwordPolicyError_(password, username);
  if (err) throw new Error(err);
  var hash = hashPassword_(password);
  var rec = withLock_(function () {
    var emp = findOne_('Employees', 'Username', username);
    if (!emp) throw new Error('ไม่พบชื่อผู้ใช้ ' + username);
    return updateRecord_('Employees', emp._row, {
      PasswordHash: hash, Role: ROLES.ADMIN, Status: EMP_STATUS.ACTIVE, MustChangePassword: true,
      SessionVersion: (Number(emp.SessionVersion) || 0) + 1, UpdatedAt: nowStamp_(),
      ActiveFrom: emp.ActiveFrom || todayStr_()
    });
  });
  props.deleteProperty('BOOTSTRAP_ADMIN_PASSWORD');
  clearLoginFailures_(username);
  writeAudit_(null, 'EMERGENCY_ADMIN_RESET', 'Employee', rec.EmployeeID, { username: username });
  var msg = '✔ รีเซ็ตรหัสผ่านและคืนสิทธิ์ผู้ดูแลระบบให้ "' + username + '" แล้ว (บังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบ)';
  Logger.log(msg);
  return msg;
}

/**
 * วัดความเร็วการเข้ารหัสรหัสผ่านบนเซิร์ฟเวอร์ Google จริง (รันจาก Editor)
 * ใช้ประกอบการปรับค่า PBKDF2_ITERATIONS ให้เข้าสู่ระบบใช้เวลาประมาณ 0.5–1.5 วินาที
 */
function BenchmarkPasswordHashing() {
  assertOwnerContext_();
  var iters = getConfiguredIterations_();
  var t0 = Date.now();
  pbkdf2Sha256_(utf8Bytes_('benchmark-password-1'), randomBytes_(16), iters);
  var ms = Date.now() - t0;
  var suggested = Math.max(CRYPTO_.MIN_ITERATIONS, Math.round(iters * 1000 / Math.max(ms, 1) / 10000) * 10000);
  var msg = 'PBKDF2 ' + iters + ' รอบ ใช้เวลา ' + ms + ' ms\n' +
    'ค่าที่แนะนำสำหรับเวลาประมาณ 1 วินาที: PBKDF2_ITERATIONS = ' + suggested + '\n' +
    '(ตั้งค่าได้ที่ Project Settings → Script Properties; รหัสผ่านเดิมจะถูกปรับอัตโนมัติเมื่อผู้ใช้เข้าสู่ระบบครั้งถัดไป)';
  Logger.log(msg);
  return msg;
}

/* ======================================================================
 * Attendance.gs
 * ====================================================================== */
/**
 * ============================================================================
 *  Attendance.gs — ลงเวลาเข้า/ออกงานด้วย GPS, Geofencing และ Dashboard บุคลากร
 * ============================================================================
 *  หลักการ:
 *   - ใช้เวลาจาก Server (Asia/Bangkok) เท่านั้น ไม่เชื่อเวลาจากโทรศัพท์
 *   - Browser ส่งมาเฉพาะ latitude, longitude, accuracy → Server คำนวณระยะทาง
 *     ด้วยสูตร Haversine และตัดสินผลเอง
 *   - ใช้ LockService + ตรวจรายการซ้ำใน DailySummary → 1 วัน เข้า 1 ครั้ง ออก 1 ครั้ง
 *   - ใช้ GPS เฉพาะตอนกดลงเวลา/ตรวจสอบตำแหน่งเท่านั้น (ไม่มีการติดตามตำแหน่ง)
 *  ข้อจำกัด: การตรวจ GPS ผ่านเว็บไม่สามารถป้องกันแอปปลอมพิกัด (Fake GPS) ได้ทั้งหมด
 * ============================================================================
 */

var EARTH_RADIUS_M_ = 6371008.8;

/** ระยะทางระหว่างสองพิกัด (เมตร) ด้วยสูตร Haversine */
function haversineM_(lat1, lon1, lat2, lon2) {
  var toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLon = (lon2 - lon1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_M_ * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** ตรวจสอบรูปแบบพิกัดที่ส่งมาจาก Browser */
function parseLocationInput_(p) {
  var lat = toNumber_(p && p.lat), lng = toNumber_(p && p.lng), acc = toNumber_(p && p.accuracy);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw appError_('ไม่ได้รับข้อมูลตำแหน่ง GPS ที่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 'GPS_INVALID');
  }
  if (!isFinite(acc) || acc <= 0 || acc > 100000) {
    throw appError_('ไม่ได้รับค่าความแม่นยำของ GPS กรุณาเปิดตำแหน่งแบบแม่นยำสูงแล้วลองใหม่', 'GPS_INVALID');
  }
  return { lat: lat, lng: lng, accuracy: acc };
}

/** ประเมินตำแหน่งเทียบกับพื้นที่โรงเรียน */
function evaluateLocation_(loc, s) {
  if (!s.geofenceConfigured) {
    throw appError_('ผู้ดูแลระบบยังไม่ได้ตั้งค่าพิกัดโรงเรียน จึงยังไม่สามารถลงเวลาได้', 'GEOFENCE_NOT_SET');
  }
  var distance = haversineM_(s.schoolLat, s.schoolLng, loc.lat, loc.lng);
  var inZone = distance <= s.radiusM;
  var accuracyOk = loc.accuracy <= s.maxAccuracyM;
  var result = {
    distanceM: Math.round(distance),
    accuracyM: Math.round(loc.accuracy),
    radiusM: s.radiusM,
    maxAccuracyM: s.maxAccuracyM,
    inZone: inZone,
    accuracyOk: accuracyOk,
    ok: inZone && accuracyOk,
    maps: mapLinks_(loc.lat, loc.lng),
    schoolMaps: mapLinks_(s.schoolLat, s.schoolLng)
  };
  if (!accuracyOk) {
    result.message = 'สัญญาณ GPS ยังไม่แม่นยำพอ (คลาดเคลื่อน ±' + result.accuracyM + ' ม. เกณฑ์ไม่เกิน ' +
      s.maxAccuracyM + ' ม.) กรุณาเปิดตำแหน่งแบบแม่นยำสูง ออกไปบริเวณที่โล่ง รอสักครู่แล้วลองใหม่';
  } else if (!inZone) {
    result.message = 'ท่านอยู่นอกพื้นที่โรงเรียน (ห่าง ' + formatDistance_(result.distanceM) +
      ' เกินรัศมีที่กำหนด ' + s.radiusM + ' ม.)';
  } else {
    result.message = 'อยู่ในพื้นที่โรงเรียน (ห่างจากจุดศูนย์กลาง ' + formatDistance_(result.distanceM) + ')';
  }
  return result;
}

function formatDistance_(m) {
  return m >= 1000 ? round_(m / 1000, 2) + ' กม.' : Math.round(m) + ' ม.';
}

/** ตรวจสอบตำแหน่งโดยไม่บันทึก (ผู้ใช้กดปุ่ม "ตรวจสอบตำแหน่ง" เอง) */
function previewLocation_(ctx, p) {
  return evaluateLocation_(parseLocationInput_(p), ctx.settings);
}

/** สถานะของรายการเข้า/ออกตามเวลาที่ตั้งค่า */
function computeLogStatus_(type, time, dayInfo, s) {
  if (!dayInfo.isWorkday) return { status: 'HOLIDAY', isLate: false, lateMinutes: 0, early: false };
  if (type === 'IN') {
    var late = timeToMin_(time) > timeToMin_(s.lateAfter) + (59 / 60); // หลัง 08:30:59 ถือว่าสาย
    var lateMin = late ? Math.max(0, Math.floor(timeToMin_(time) - timeToMin_(s.workStart))) : 0;
    return { status: late ? 'LATE' : 'ON_TIME', isLate: late, lateMinutes: lateMin, early: false };
  }
  var early = timeToMin_(time) < timeToMin_(s.workEnd);
  return { status: early ? 'EARLY' : 'NORMAL', isLate: false, lateMinutes: 0, early: early };
}

function summaryKey_(date, empId) { return date + '|' + empId; }

/** สร้าง/ปรับปรุงแถว DailySummary (เรียกภายใต้ Lock) */
function upsertDailySummary_(date, emp, patch) {
  var key = summaryKey_(date, emp.EmployeeID);
  var existing = findOne_('DailySummary', 'Key', key);
  var base = existing || {
    Key: key, Date: date, EmployeeID: emp.EmployeeID, StaffCode: emp.StaffCode, FullName: emp.FullName,
    CheckInTime: '', CheckOutTime: '', CheckInLogID: '', CheckOutLogID: '', InDistanceM: null, OutDistanceM: null,
    IsLate: false, LateMinutes: 0, EarlyLeave: false, WorkMinutes: null, DayType: '', Corrected: false, UpdatedAt: ''
  };
  var merged = {};
  for (var k in base) if (k !== '_row') merged[k] = base[k];
  for (var p in patch) merged[p] = patch[p];
  if (merged.CheckInTime && merged.CheckOutTime) {
    merged.WorkMinutes = Math.max(0, Math.round(timeToMin_(merged.CheckOutTime) - timeToMin_(merged.CheckInTime)));
  } else {
    merged.WorkMinutes = null;
  }
  merged.UpdatedAt = nowStamp_();
  if (existing) updateRecord_('DailySummary', existing._row, merged);
  else appendRecord_('DailySummary', merged);
  return merged;
}

/**
 * ลงเวลาเข้า/ออกงาน
 * @param {Object} ctx Session context
 * @param {'IN'|'OUT'} type
 * @param {{lat:number,lng:number,accuracy:number}} p
 */
function recordAttendance_(ctx, type, p) {
  var s = ctx.settings;
  var emp = ctx.user;
  // ลงเวลาเข้าต้องตรวจ GPS เสมอ; ลงเวลาออกตรวจเฉพาะเมื่อเปิดการตั้งค่า CHECKOUT_REQUIRES_GPS
  var needGps = type === 'IN' || s.checkoutRequiresGps;
  var loc = null, ev = null;
  if (needGps) {
    loc = parseLocationInput_(p);
    ev = evaluateLocation_(loc, s);
    if (!ev.ok) {
      writeAudit_(ctx, type === 'IN' ? 'CHECKIN_REJECTED' : 'CHECKOUT_REJECTED', 'Attendance', '',
        { distanceM: ev.distanceM, accuracyM: ev.accuracyM, inZone: ev.inZone, accuracyOk: ev.accuracyOk });
      throw appError_(ev.message, ev.accuracyOk ? 'OUT_OF_ZONE' : 'GPS_ACCURACY', ev);
    }
  } else if (p && p.lat !== undefined && p.lat !== null && p.lat !== '') {
    // ไม่บังคับตรวจ แต่ถ้าเบราว์เซอร์ส่งพิกัดมา (หน้าเว็บรุ่นเก่า) ให้บันทึกระยะไว้เป็นข้อมูลประกอบ
    try { loc = parseLocationInput_(p); ev = s.geofenceConfigured ? evaluateLocation_(loc, s) : null; } catch (e) { loc = null; ev = null; }
  }

  var result = withLock_(function () {
    // เวลาจาก Server (อ่านภายใน Lock เพื่อให้ลำดับเวลาถูกต้อง)
    var date = todayStr_();
    var time = nowTimeStr_();
    var dayInfo = getDayInfo_(date, s);
    if (!dayInfo.isWorkday && !s.allowHolidayCheckin) {
      throw appError_('วันนี้เป็นวันหยุด (' + dayInfo.holidayName + ') ระบบไม่เปิดให้ลงเวลา', 'HOLIDAY');
    }
    if (type === 'IN' && timeToMin_(time) < timeToMin_(s.checkinEarliest)) {
      throw appError_('ยังไม่ถึงเวลาเปิดให้ลงเวลาเข้างาน (เปิดตั้งแต่ ' + s.checkinEarliest + ' น.)', 'TOO_EARLY');
    }
    if (emp.ActiveFrom && date < emp.ActiveFrom) {
      throw appError_('บัญชีของท่านเริ่มนับสถิติตั้งแต่ ' + thaiDate_(emp.ActiveFrom), 'NOT_ACTIVE_YET');
    }
    var summary = findOne_('DailySummary', 'Key', summaryKey_(date, emp.EmployeeID));
    if (type === 'IN' && summary && summary.CheckInTime) {
      throw appError_('ท่านลงเวลาเข้างานของวันนี้แล้ว เมื่อเวลา ' + summary.CheckInTime.substr(0, 5) + ' น.', 'DUPLICATE');
    }
    if (type === 'OUT') {
      // ลืมลงเวลาเข้าแต่ยื่นคำร้องแก้ไขเวลาเข้าของวันนี้แล้ว → ลงเวลาออกได้ตามปกติ
      if ((!summary || !summary.CheckInTime) && !hasPendingInCorrection_(emp.EmployeeID, date)) {
        throw appError_('ยังไม่มีการลงเวลาเข้างานของวันนี้ กรุณาลงเวลาเข้างานก่อน (หากลืมลงเวลาเข้า ให้ยื่นคำร้องแก้ไขเวลา)', 'NO_CHECKIN');
      }
      if (summary && summary.CheckOutTime) {
        throw appError_('ท่านลงเวลาออกงานของวันนี้แล้ว เมื่อเวลา ' + summary.CheckOutTime.substr(0, 5) + ' น.', 'DUPLICATE');
      }
    }
    var st = computeLogStatus_(type, time, dayInfo, s);
    var log = {
      AttendanceID: newId_(type === 'IN' ? 'IN' : 'OUT'),
      EmployeeID: emp.EmployeeID, StaffCode: emp.StaffCode, FullName: emp.FullName,
      Type: type, Date: date, Time: time, Timestamp: date + ' ' + time,
      Latitude: loc ? round_(loc.lat, 7) : '', Longitude: loc ? round_(loc.lng, 7) : '', Accuracy: loc ? round_(loc.accuracy, 1) : '',
      DistanceM: ev ? ev.distanceM : '', Status: st.status, Source: loc ? 'GPS' : 'NO_GPS', IsActive: true,
      SupersededBy: '', RefID: '', Note: needGps ? '' : 'ลงเวลาออกโดยไม่บังคับตรวจตำแหน่ง'
    };
    appendRecord_('AttendanceLogs', log);
    var patch = { DayType: dayInfo.isWorkday ? 'WORKDAY' : 'HOLIDAY' };
    if (type === 'IN') {
      patch.CheckInTime = time; patch.CheckInLogID = log.AttendanceID; patch.InDistanceM = ev.distanceM;
      patch.IsLate = st.isLate; patch.LateMinutes = st.lateMinutes;
    } else {
      patch.CheckOutTime = time; patch.CheckOutLogID = log.AttendanceID; patch.OutDistanceM = ev ? ev.distanceM : null;
      patch.EarlyLeave = st.early;
    }
    upsertDailySummary_(date, emp, patch);
    return { log: log, status: st, dayInfo: dayInfo };
  });

  var log = result.log;
  return {
    attendanceId: log.AttendanceID,
    type: type,
    typeLabel: ATT_TYPES[type],
    date: log.Date,
    dateLabel: thaiDate_(log.Date, 'long'),
    time: log.Time,
    status: log.Status,
    statusLabel: ATT_STATUS_LABELS[log.Status],
    lateMinutes: result.status.lateMinutes,
    gpsChecked: needGps,
    distanceM: ev ? ev.distanceM : null,
    accuracyM: ev ? ev.accuracyM : null,
    radiusM: s.radiusM,
    inZone: ev ? ev.inZone : null,
    maps: ev ? ev.maps : null,
    message: (type === 'IN' ? 'ลงเวลาเข้างานสำเร็จ' : 'ลงเวลาออกงานสำเร็จ') + ' เวลา ' + log.Time.substr(0, 5) + ' น.'
  };
}

/* ========================================================================== */
/*  Personal dashboard / history                                              */
/* ========================================================================== */

/** ข้อมูลหน้า Dashboard ของบุคลากร (เรียกครั้งเดียวต่อการเปิดหน้า เพื่อประหยัดโควตา) */
function getMyDashboard_(ctx) {
  var s = ctx.settings;
  var emp = ctx.user;
  var today = todayStr_();
  var dayInfo = getDayInfo_(today, s);
  var y = +today.substr(0, 4), m = +today.substr(5, 2);
  var month = computeAttendance_({ employees: [emp], from: monthStart_(y, m), to: monthEnd_(y, m) });
  var me = month.people[0];
  var todayRow = null;
  for (var i = 0; i < me.days.length; i++) if (me.days[i].date === today) todayRow = me.days[i];
  var recent = me.days.filter(function (d) { return d.date <= today && (d.checkIn || d.checkOut || d.status === 'LEAVE' || d.status === 'ABSENT'); })
    .slice(-7).reverse();
  if (recent.length < 7) {
    // เติมจากเดือนก่อนหน้าให้ครบ 7 รายการ
    var prevEnd = addDays_(monthStart_(y, m), -1);
    var prev = computeAttendance_({ employees: [emp], from: addDays_(prevEnd, -20), to: prevEnd }).people[0];
    var extra = prev.days.filter(function (d) { return d.checkIn || d.checkOut || d.status === 'LEAVE' || d.status === 'ABSENT'; }).reverse();
    recent = recent.concat(extra).slice(0, 7);
  }
  var myLeaves = readAll_('LeaveRequests').filter(function (r) { return r.EmployeeID === emp.EmployeeID && r.Status === 'PENDING'; }).length;
  var myCorr = readAll_('CorrectionRequests').filter(function (r) { return r.EmployeeID === emp.EmployeeID && r.Status === 'PENDING'; }).length;
  return {
    profile: publicUser_(emp),
    serverNow: nowMs_(),
    today: {
      date: today,
      dateLabel: thaiDate_(today, 'long'),
      isWorkday: dayInfo.isWorkday,
      holidayName: dayInfo.holidayName,
      row: todayRow
    },
    settings: clientSettings_(s),
    month: { year: y, month: m, label: thaiMonthYear_(y, m), totals: me.totals },
    recent: recent,
    pending: { leaves: myLeaves, corrections: myCorr, todayIn: hasPendingInCorrection_(emp.EmployeeID, today) },
    approvals: approvalCounts_(emp),
    announcement: getAnnouncement_(),
    issues: myAttendanceIssues_(emp, s, today)
  };
}

/**
 * งานที่ผู้บริหาร/ผู้ดูแลต้องพิจารณา (ไม่นับคำขอของตนเองซึ่งพิจารณาเองไม่ได้) — บุคลากรทั่วไปได้ null
 */
function approvalCounts_(emp) {
  if (emp.Role !== ROLES.ADMIN && emp.Role !== ROLES.EXECUTIVE) return null;
  var notMine = function (r) { return r.Status === REQUEST_STATUS.PENDING && r.EmployeeID !== emp.EmployeeID; };
  var out = {
    leaves: readAll_('LeaveRequests').filter(notMine).length,
    corrections: readAll_('CorrectionRequests').filter(notMine).length,
    registrations: 0, passwordResets: 0
  };
  if (emp.Role === ROLES.ADMIN) {
    getEmployees_().forEach(function (e) {
      if (e.Status === EMP_STATUS.PENDING) out.registrations++;
      if (e.Status === EMP_STATUS.ACTIVE && e.ResetRequestedAt) out.passwordResets++;
    });
  }
  out.total = out.leaves + out.corrections + out.registrations + out.passwordResets;
  return out;
}

/** มีคำร้องแก้ไข "เวลาเข้า" ของวันที่ระบุรอพิจารณาอยู่หรือไม่ */
function hasPendingInCorrection_(empId, date) {
  return readAll_('CorrectionRequests').some(function (c) {
    return c.EmployeeID === empId && c.Date === date && c.Type === 'IN' && c.Status === REQUEST_STATUS.PENDING;
  });
}

/**
 * วันที่ลงเวลาไม่ครบในช่วงที่ยื่นคำร้องแก้ไขได้ (ไม่เกิน 14 วันล่าสุด ไม่รวมวันนี้)
 * ไม่แสดงวันที่มีคำร้องแก้ไขเวลา/ใบลารออนุมัติอยู่แล้ว
 */
function myAttendanceIssues_(emp, s, today) {
  var to = addDays_(today, -1);
  var from = addDays_(today, -Math.min(14, s.correctionMaxDays));
  if (emp.ActiveFrom && from < emp.ActiveFrom) from = emp.ActiveFrom;
  if (from > to) return [];
  var person = computeAttendance_({ employees: [emp], from: from, to: to }).people[0];
  if (!person) return [];
  var pendingCorr = {};
  readAll_('CorrectionRequests').forEach(function (c) {
    if (c.EmployeeID === emp.EmployeeID && c.Status === REQUEST_STATUS.PENDING) pendingCorr[c.Date + '|' + c.Type] = true;
  });
  var pendingLeave = readAll_('LeaveRequests').filter(function (l) {
    return l.EmployeeID === emp.EmployeeID && l.Status === REQUEST_STATUS.PENDING && l.EndDate >= from && l.StartDate <= to;
  });
  var out = [];
  person.days.forEach(function (d) {
    if (!d.isWorkday) return;
    var kind = d.status === 'ABSENT' ? 'ABSENT' : (d.missingIn ? 'MISSING_IN' : (d.missingOut ? 'MISSING_OUT' : ''));
    if (!kind) return;
    var leavePending = pendingLeave.some(function (l) { return l.StartDate <= d.date && l.EndDate >= d.date; });
    if (leavePending) return;
    if (kind === 'MISSING_IN' && pendingCorr[d.date + '|IN']) return;
    if (kind === 'MISSING_OUT' && pendingCorr[d.date + '|OUT']) return;
    if (kind === 'ABSENT' && pendingCorr[d.date + '|IN']) return;
    out.push({
      date: d.date, dateLabel: thaiDate_(d.date, 'short'), dayName: THAI_DAYS_SHORT[dayOfWeek_(d.date)],
      kind: kind, checkIn: d.checkIn ? d.checkIn.substr(0, 5) : '', checkOut: d.checkOut ? d.checkOut.substr(0, 5) : ''
    });
  });
  return out.reverse().slice(0, 5);
}

/** การตั้งค่าที่ฝั่ง Browser จำเป็นต้องรู้ (ไม่มีข้อมูลลับ) */
function clientSettings_(s) {
  return {
    workStart: s.workStart, lateAfter: s.lateAfter, workEnd: s.workEnd, checkinEarliest: s.checkinEarliest,
    radiusM: s.radiusM, maxAccuracyM: s.maxAccuracyM, geofenceConfigured: s.geofenceConfigured,
    sessionTimeoutMin: s.sessionTimeoutMin, gpsRetentionDays: s.gpsRetentionDays,
    correctionMaxDays: s.correctionMaxDays, workDays: s.workDays, leaveRequiresApproval: s.leaveRequiresApproval,
    checkoutRequiresGps: s.checkoutRequiresGps,
    schoolMaps: s.geofenceConfigured ? mapLinks_(s.schoolLat, s.schoolLng) : null
  };
}

/** ประวัติการลงเวลารายเดือนของตนเอง */
function getMyHistory_(ctx, p) {
  var ym = parseYearMonth_(p);
  var res = computeAttendance_({ employees: [ctx.user], from: monthStart_(ym.y, ym.m), to: monthEnd_(ym.y, ym.m) });
  var me = res.people[0];
  var today = todayStr_();
  return {
    year: ym.y, month: ym.m, label: thaiMonthYear_(ym.y, ym.m),
    totals: me.totals,
    days: me.days.filter(function (d) { return d.date <= today; }).reverse()
  };
}

function parseYearMonth_(p) {
  var today = todayStr_();
  var y = parseInt(p && p.year, 10), m = parseInt(p && p.month, 10);
  if (!isFinite(y) || y < 2000 || y > 2200) y = +today.substr(0, 4);
  if (!isFinite(m) || m < 1 || m > 12) m = +today.substr(5, 2);
  return { y: y, m: m };
}

/* ======================================================================
 * Leave.gs
 * ====================================================================== */
/**
 * ============================================================================
 *  Leave.gs — ระบบการลา, คำร้องแก้ไขเวลา และเอกสารแนบ (Google Drive แบบไม่เปิดสาธารณะ)
 * ============================================================================
 *  - การอนุมัติคำร้องแก้ไขเวลา "ไม่ลบ" รายการเดิม: รายการเดิมถูกตั้ง IsActive = FALSE
 *    และอ้างอิง SupersededBy ไปยังรายการใหม่ พร้อมบันทึก Audit Log (ก่อน/หลัง)
 *  - ผู้อนุมัติไม่สามารถอนุมัติคำขอของตนเองได้ (แบ่งแยกหน้าที่)
 *  - ไฟล์แนบเก็บในโฟลเดอร์ Drive ของเจ้าของระบบ (ไม่แชร์สาธารณะ)
 *    ผู้มีสิทธิ์ดูไฟล์ผ่านระบบเท่านั้น: เจ้าของคำขอ, ผู้บริหาร, ผู้ดูแลระบบ
 * ============================================================================
 */

var ATTACH_ = {
  MAX_BYTES: 5 * 1024 * 1024,
  MIME: { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
};

/* ========================================================================== */
/*  Attachments                                                               */
/* ========================================================================== */

/** บันทึกไฟล์แนบ (base64) ลง Google Drive → {fileId, name} หรือ null */
function saveAttachment_(file, prefix) {
  if (!file || !file.data) return null;
  var mime = String(file.mimeType || '');
  if (!ATTACH_.MIME[mime]) throw appError_('รองรับไฟล์แนบเฉพาะ PDF, JPG, PNG, WEBP เท่านั้น', 'VALIDATION', { field: 'attachment' });
  var bytes;
  try { bytes = Utilities.base64Decode(String(file.data)); } catch (e) { throw appError_('ไฟล์แนบไม่ถูกต้อง', 'VALIDATION'); }
  if (!bytes.length || bytes.length > ATTACH_.MAX_BYTES) throw appError_('ไฟล์แนบต้องมีขนาดไม่เกิน 5 MB', 'VALIDATION', { field: 'attachment' });
  if (!verifyMagicBytes_(bytes, mime)) throw appError_('เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ', 'VALIDATION', { field: 'attachment' });
  var original = cleanLine_(file.name, 120).replace(/[\\\/:*?"<>|]/g, '_') || ('file.' + ATTACH_.MIME[mime]);
  var folderId = scriptProps_().ATTACHMENT_FOLDER_ID;
  if (!folderId) throw appError_('ระบบยังไม่ได้สร้างโฟลเดอร์เก็บเอกสาร กรุณาให้ผู้ดูแลรัน SetupSystem()', 'NOT_SETUP');
  var blob = Utilities.newBlob(bytes, mime, prefix + '_' + original);
  var f = DriveApp.getFolderById(folderId).createFile(blob);
  return { fileId: f.getId(), name: original };
}

/** ถ้าบันทึกคำขอไม่สำเร็จ ให้ย้ายไฟล์แนบที่อัปโหลดแล้วไปถังขยะ */
function withAttachmentCleanup_(att, fn) {
  try {
    return fn();
  } catch (e) {
    if (att) { try { DriveApp.getFileById(att.fileId).setTrashed(true); } catch (e2) { /* ignore */ } }
    throw e;
  }
}

function verifyMagicBytes_(b, mime) {
  function at(i) { return b[i] & 0xff; }
  if (mime === 'application/pdf') return at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46;
  if (mime === 'image/jpeg') return at(0) === 0xff && at(1) === 0xd8;
  if (mime === 'image/png') return at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47;
  if (mime === 'image/webp') return at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45;
  return false;
}

/** ดาวน์โหลดไฟล์แนบผ่านระบบ (ตรวจสิทธิ์ก่อนทุกครั้ง) */
function getAttachment_(ctx, p) {
  var kind = p.kind === 'correction' ? 'CorrectionRequests' : 'LeaveRequests';
  var idField = kind === 'LeaveRequests' ? 'LeaveID' : 'RequestID';
  var rec = findOne_(kind, idField, String(p.id || ''));
  if (!rec || !rec.AttachmentFileId) throw appError_('ไม่พบเอกสารแนบ', 'NOT_FOUND');
  var privileged = ctx.user.Role === ROLES.ADMIN || ctx.user.Role === ROLES.EXECUTIVE;
  if (rec.EmployeeID !== ctx.user.EmployeeID && !privileged) {
    writeAudit_(ctx, 'ACCESS_DENIED', kind, rec[idField], { reason: 'attachment' });
    throw appError_('คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้', 'FORBIDDEN');
  }
  var blob = DriveApp.getFileById(rec.AttachmentFileId).getBlob();
  return { name: rec.AttachmentName || blob.getName(), mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

/* ========================================================================== */
/*  Leave requests                                                            */
/* ========================================================================== */

/** นับวันทำการในช่วงวันที่ */
function countWorkdays_(from, to) {
  var s = getSettings_(), cal = getCalendarMap_();
  return dateList_(from, to).filter(function (d) { return getDayInfo_(d, s, cal).isWorkday; }).length;
}

/** ชื่อประเภทการลาสำหรับแสดงผล (ประเภท "อื่น ๆ" ใช้ข้อความที่พิมพ์เอง) */
function leaveTypeLabel_(r) {
  if (r.LeaveType === 'OTHER' && r.TypeDetail) return r.TypeDetail;
  return LEAVE_TYPES[r.LeaveType] || r.LeaveType;
}

/** บุคลากรยกเลิกเองได้: รออนุมัติ หรืออนุมัติอัตโนมัติ (ไม่มีผู้พิจารณา) */
function leaveSelfCancellable_(r) {
  return r.Status === 'PENDING' || (r.Status === 'APPROVED' && r.ReviewedBy === 'AUTO');
}

function leaveView_(r) {
  return {
    leaveId: r.LeaveID, employeeId: r.EmployeeID, staffCode: r.StaffCode, fullName: r.FullName,
    type: r.LeaveType, typeLabel: leaveTypeLabel_(r), typeDetail: r.TypeDetail || '',
    startDate: r.StartDate, endDate: r.EndDate,
    startLabel: thaiDate_(r.StartDate), endLabel: thaiDate_(r.EndDate),
    period: r.Period || 'FULL', periodLabel: LEAVE_PERIODS[r.Period || 'FULL'],
    days: r.Days, reason: r.Reason, hasAttachment: !!r.AttachmentFileId, attachmentName: r.AttachmentName,
    status: r.Status, statusLabel: REQUEST_STATUS_LABELS[r.Status] || r.Status,
    requestedAt: r.RequestedAt, requestedLabel: thaiStamp_(r.RequestedAt),
    recordedBy: r.RecordedBy && r.RecordedBy !== 'SELF' ? r.RecordedBy : '',
    reviewedByName: r.ReviewedByName, reviewedAt: r.ReviewedAt, reviewedLabel: thaiStamp_(r.ReviewedAt), reviewNote: r.ReviewNote,
    cancellable: leaveSelfCancellable_(r),
    printable: leaveFormAvailable_(r)
  };
}

/**
 * ตรวจสอบและบันทึกใบลา (ใช้ร่วมกันทั้งบุคลากรบันทึกเองและผู้ดูแลบันทึกให้)
 * - ลาย้อนหลังได้ไม่จำกัด และล่วงหน้าได้ไม่เกิน 2 ปี, ช่วงลาครั้งละไม่เกิน 1 ปี
 * - เหตุผลไม่บังคับ; ประเภท "อื่น ๆ" ต้องพิมพ์ชื่อประเภทการลา
 * @param {Object} emp บุคลากรเจ้าของใบลา
 * @param {Object} p ข้อมูลจาก Browser
 * @param {{approvedBy: Object|null, auto: boolean, recordedBy: string}} opts
 */
function createLeave_(emp, p, opts) {
  var type = String(p.type || '');
  if (!LEAVE_TYPES[type]) throw appError_('กรุณาเลือกประเภทการลา', 'VALIDATION', { field: 'type' });
  var detail = cleanLine_(p.typeDetail, 100);
  if (type === 'OTHER') {
    if (detail.length < 2) throw appError_('กรุณาพิมพ์ประเภทการลา เช่น ลาอุปสมบท', 'VALIDATION', { field: 'typeDetail' });
    if (detail.length > 60) throw appError_('ประเภทการลาต้องไม่เกิน 60 ตัวอักษร', 'VALIDATION', { field: 'typeDetail' });
  } else {
    detail = '';
  }
  var start = String(p.startDate || ''), end = String(p.endDate || p.startDate || '');
  if (!isValidYmd_(start)) throw appError_('กรุณาเลือกวันที่เริ่มลา', 'VALIDATION', { field: 'startDate' });
  if (!isValidYmd_(end)) throw appError_('กรุณาเลือกวันที่สิ้นสุด', 'VALIDATION', { field: 'endDate' });
  if (end < start) throw appError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา', 'VALIDATION', { field: 'endDate' });
  if (daysBetween_(start, end) > 365) throw appError_('บันทึกการลาได้ครั้งละไม่เกิน 1 ปี', 'VALIDATION', { field: 'endDate' });
  if (start > addDays_(todayStr_(), 730)) throw appError_('บันทึกการลาล่วงหน้าได้ไม่เกิน 2 ปี', 'VALIDATION', { field: 'startDate' });
  var period = String(p.period || 'FULL');
  if (!LEAVE_PERIODS[period]) period = 'FULL';
  if (period !== 'FULL' && start !== end) throw appError_('การลาครึ่งวันต้องเป็นวันเดียวกัน', 'VALIDATION', { field: 'period' });
  var reason = cleanText_(p.reason, 1000);
  if (reason.length > 500) throw appError_('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'VALIDATION', { field: 'reason' });
  var calendarDays = !!CALENDAR_DAY_LEAVE_TYPES_[type];
  if (calendarDays) period = 'FULL'; // ลาคลอดบุตรนับเป็นวันต่อเนื่อง ไม่มีลาครึ่งวัน
  var workdays = countWorkdays_(start, end);
  if (!workdays && !calendarDays) throw appError_('ช่วงวันที่เลือกเป็นวันหยุดทั้งหมด ไม่ต้องบันทึกการลา', 'VALIDATION', { field: 'startDate' });
  var days = calendarDays ? daysBetween_(start, end) + 1 : (period === 'FULL' ? workdays : 0.5);

  var leaveId = newId_('LV');
  var att = saveAttachment_(p.attachment, leaveId);
  return withAttachmentCleanup_(att, function () { return withLock_(function () {
    var overlap = readAll_('LeaveRequests').filter(function (r) {
      return r.EmployeeID === emp.EmployeeID && (r.Status === 'PENDING' || r.Status === 'APPROVED') &&
        r.StartDate <= end && r.EndDate >= start;
    });
    if (overlap.length) {
      throw appError_('มีใบลาในช่วงวันที่นี้อยู่แล้ว (' + leaveTypeLabel_(overlap[0]) + ' ' + thaiDate_(overlap[0].StartDate, 'short') +
        (overlap[0].EndDate !== overlap[0].StartDate ? ' – ' + thaiDate_(overlap[0].EndDate, 'short') : '') + ')', 'DUPLICATE');
    }
    var now = nowStamp_();
    var r = {
      LeaveID: leaveId, EmployeeID: emp.EmployeeID, StaffCode: emp.StaffCode, FullName: emp.FullName,
      LeaveType: type, TypeDetail: detail, StartDate: start, EndDate: end, Period: period, Days: days, Reason: reason,
      AttachmentFileId: att ? att.fileId : '', AttachmentName: att ? att.name : '',
      Status: 'PENDING', RequestedAt: now, RecordedBy: opts.recordedBy || 'SELF',
      ReviewedBy: '', ReviewedByName: '', ReviewedAt: '', ReviewNote: ''
    };
    if (opts.approvedBy) {
      r.Status = 'APPROVED'; r.ReviewedBy = opts.approvedBy.EmployeeID; r.ReviewedByName = opts.approvedBy.FullName;
      r.ReviewedAt = now; r.ReviewNote = 'บันทึกโดย ' + opts.approvedBy.FullName;
    } else if (opts.auto) {
      r.Status = 'APPROVED'; r.ReviewedBy = 'AUTO'; r.ReviewedByName = 'อนุมัติอัตโนมัติ';
      r.ReviewedAt = now; r.ReviewNote = 'โรงเรียนตั้งค่าให้การลามีผลทันทีโดยไม่ต้องรออนุมัติ';
    }
    appendRecord_('LeaveRequests', r);
    return r;
  }); });
}

/** บุคลากรบันทึกการลาของตนเอง (แตะประเภทการลา → ยืนยัน) */
function submitLeave_(ctx, p) {
  var auto = !ctx.settings.leaveRequiresApproval;
  var rec = createLeave_(ctx.user, p, { auto: auto, recordedBy: 'SELF' });
  writeAudit_(ctx, 'LEAVE_SUBMIT', 'LeaveRequest', rec.LeaveID, {
    type: rec.LeaveType, detail: rec.TypeDetail, start: rec.StartDate, end: rec.EndDate, period: rec.Period, days: rec.Days, status: rec.Status
  });
  return {
    leave: leaveView_(rec),
    message: auto ? 'บันทึกการลาเรียบร้อยแล้ว (' + leaveTypeLabel_(rec) + ' ' + rec.Days + ' วัน)'
      : 'ส่งใบลาเรียบร้อยแล้ว (' + leaveTypeLabel_(rec) + ' ' + rec.Days + ' วัน) รอผู้บริหาร/ผู้ดูแลระบบอนุมัติ'
  };
}

/**
 * ผู้บริหาร/ผู้ดูแลระบบบันทึกการลาแทนบุคลากร → อนุมัติทันที
 * (ถ้าบันทึกให้ตนเอง จะเป็นใบลารออนุมัติตามปกติ เพื่อให้ผู้อื่นตรวจสอบ)
 */
function adminRecordLeave_(ctx, p) {
  var emp = getEmployeeById_(String(p.employeeId || ''));
  if (!emp) throw appError_('กรุณาเลือกบุคลากร', 'VALIDATION', { field: 'employeeId' });
  if (emp.Status !== EMP_STATUS.ACTIVE) throw appError_('บัญชีนี้ไม่ได้อยู่ในสถานะใช้งาน', 'VALIDATION', { field: 'employeeId' });
  var self = emp.EmployeeID === ctx.user.EmployeeID;
  var rec = createLeave_(emp, p, { approvedBy: self ? null : ctx.user, recordedBy: ctx.user.FullName });
  writeAudit_(ctx, 'LEAVE_RECORD_BY_ADMIN', 'LeaveRequest', rec.LeaveID, {
    employee: emp.FullName, type: rec.LeaveType, detail: rec.TypeDetail, start: rec.StartDate, end: rec.EndDate,
    period: rec.Period, days: rec.Days, status: rec.Status
  });
  return {
    leave: leaveView_(rec),
    message: self ? 'บันทึกใบลาของท่านแล้ว — ต้องให้ผู้บริหาร/ผู้ดูแลท่านอื่นอนุมัติ'
      : 'บันทึกการลาให้ ' + emp.FullName + ' เรียบร้อย (' + leaveTypeLabel_(rec) + ' ' + rec.Days + ' วัน · อนุมัติแล้ว)'
  };
}

function listMyLeaves_(ctx) {
  return readAll_('LeaveRequests').filter(function (r) { return r.EmployeeID === ctx.user.EmployeeID; })
    .sort(function (a, b) { return a.RequestedAt < b.RequestedAt ? 1 : -1; })
    .slice(0, 100).map(leaveView_);
}

function cancelLeave_(ctx, p) {
  var rec = withLock_(function () {
    var r = findOne_('LeaveRequests', 'LeaveID', String(p.leaveId || ''));
    if (!r || r.EmployeeID !== ctx.user.EmployeeID) throw appError_('ไม่พบใบลา', 'NOT_FOUND');
    if (!leaveSelfCancellable_(r)) throw appError_('ใบลานี้ได้รับการพิจารณาแล้ว หากต้องการยกเลิกกรุณาติดต่อผู้บริหาร/ผู้ดูแลระบบ', 'VALIDATION');
    return updateRecord_('LeaveRequests', r._row, { Status: 'CANCELLED', ReviewNote: 'ผู้ยื่นยกเลิกเอง', ReviewedAt: nowStamp_() });
  });
  writeAudit_(ctx, 'LEAVE_CANCEL', 'LeaveRequest', rec.LeaveID, null);
  return { leave: leaveView_(rec), message: 'ยกเลิกใบลาแล้ว' };
}

function adminListLeaves_(ctx, p) {
  var status = String(p.status || 'PENDING');
  var q = cleanLine_(p.q, 60).toLowerCase();
  return readAll_('LeaveRequests').filter(function (r) {
    if (status !== 'ALL' && r.Status !== status) return false;
    if (q && (r.FullName + ' ' + r.StaffCode).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return a.RequestedAt < b.RequestedAt ? 1 : -1; })
    .slice(0, 300).map(leaveView_);
}

/**
 * พิจารณาใบลา
 * @param {{leaveId: string, decision: 'APPROVE'|'REJECT'|'REVOKE', note: string}} p
 */
function reviewLeave_(ctx, p) {
  var decision = String(p.decision || '');
  if (['APPROVE', 'REJECT', 'REVOKE'].indexOf(decision) < 0) throw appError_('คำสั่งไม่ถูกต้อง', 'VALIDATION');
  var note = cleanText_(p.note, 500);
  if ((decision === 'REJECT' || decision === 'REVOKE') && note.length < 2) {
    throw appError_('กรุณาระบุเหตุผลประกอบการไม่อนุมัติ/ยกเลิก', 'VALIDATION', { field: 'note' });
  }
  var out = withLock_(function () {
    var r = findOne_('LeaveRequests', 'LeaveID', String(p.leaveId || ''));
    if (!r) throw appError_('ไม่พบใบลา', 'NOT_FOUND');
    if (r.EmployeeID === ctx.user.EmployeeID) throw appError_('ไม่สามารถพิจารณาใบลาของตนเองได้ กรุณาให้ผู้บริหาร/ผู้ดูแลระบบท่านอื่นพิจารณา', 'FORBIDDEN');
    if (decision === 'REVOKE' && r.Status !== 'APPROVED') throw appError_('ยกเลิกได้เฉพาะใบลาที่อนุมัติแล้ว', 'VALIDATION');
    if (decision !== 'REVOKE' && r.Status !== 'PENDING') throw appError_('ใบลานี้ได้รับการพิจารณาแล้ว', 'VALIDATION');
    var newStatus = decision === 'APPROVE' ? 'APPROVED' : (decision === 'REJECT' ? 'REJECTED' : 'CANCELLED');
    var updated = updateRecord_('LeaveRequests', r._row, {
      Status: newStatus, ReviewedBy: ctx.user.EmployeeID, ReviewedByName: ctx.user.FullName,
      ReviewedAt: nowStamp_(), ReviewNote: note
    });
    return { before: r, after: updated };
  });
  writeAudit_(ctx, 'LEAVE_' + decision, 'LeaveRequest', out.after.LeaveID, {
    employee: out.after.FullName, before: out.before.Status, after: out.after.Status, note: note
  });
  return { leave: leaveView_(out.after), message: decision === 'APPROVE' ? 'อนุมัติใบลาแล้ว' : (decision === 'REJECT' ? 'ไม่อนุมัติใบลาแล้ว' : 'ยกเลิกการอนุมัติแล้ว') };
}

/**
 * อนุมัติหลายรายการในครั้งเดียว (ใช้ฟังก์ชันพิจารณาทีละรายการเดิม จึงตรวจสิทธิ์/บันทึก Audit ครบทุกรายการ)
 * รายการที่อนุมัติไม่ได้ (เช่น ของตนเอง หรือเวลาไม่สมเหตุสมผล) จะข้ามและแจ้งเหตุผล
 */
function approveMany_(ctx, ids, reviewFn, idKey) {
  ids = Array.isArray(ids) ? ids.map(String).filter(function (x, i, a) { return x && a.indexOf(x) === i; }) : [];
  if (!ids.length) throw appError_('ไม่มีรายการที่ต้องอนุมัติ', 'VALIDATION');
  if (ids.length > 50) throw appError_('อนุมัติได้ครั้งละไม่เกิน 50 รายการ', 'VALIDATION');
  var approved = 0, skipped = [];
  ids.forEach(function (id) {
    var p = { decision: 'APPROVE', note: '' };
    p[idKey] = id;
    try { reviewFn(ctx, p); approved++; } catch (e) { skipped.push({ id: id, reason: e.message || String(e) }); }
  });
  return {
    approved: approved, skipped: skipped,
    message: 'อนุมัติแล้ว ' + approved + ' รายการ' + (skipped.length ? ' · ข้าม ' + skipped.length + ' รายการ (' + skipped[0].reason + ')' : '')
  };
}
function approveManyLeaves_(ctx, p) { return approveMany_(ctx, p.ids, reviewLeave_, 'leaveId'); }
function approveManyCorrections_(ctx, p) { return approveMany_(ctx, p.ids, reviewCorrection_, 'requestId'); }

/* ========================================================================== */
/*  Leave statistics (ปีงบประมาณ / รอบการประเมิน) และแบบใบลาของทางราชการ        */
/* ========================================================================== */

/**
 * ประเภทการลาที่นับเป็นวันต่อเนื่อง (รวมวันหยุด) ตามระเบียบว่าด้วยการลาของข้าราชการ
 * ประเภทอื่นนับเฉพาะวันทำการ
 */
var CALENDAR_DAY_LEAVE_TYPES_ = { MATERNITY: true };

/** ประเภทการลาที่มีแบบใบลาให้พิมพ์ */
var LEAVE_FORM_TYPES_ = {
  SICK: { form: 'GENERAL', word: 'ป่วย' },
  PERSONAL: { form: 'GENERAL', word: 'กิจส่วนตัว' },
  MATERNITY: { form: 'GENERAL', word: 'คลอดบุตร' },
  VACATION: { form: 'VACATION', word: 'พักผ่อน' }
};

function leaveFormAvailable_(r) {
  return !!LEAVE_FORM_TYPES_[r.LeaveType] && (r.Status === REQUEST_STATUS.PENDING || r.Status === REQUEST_STATUS.APPROVED);
}

/** จำนวนวันลาของใบลาที่อยู่ภายในช่วง from–to (ใบลาที่คร่อมช่วงนับเฉพาะส่วนที่อยู่ในช่วง) */
function leaveDaysInRange_(l, from, to) {
  var a = l.StartDate > from ? l.StartDate : from;
  var b = l.EndDate < to ? l.EndDate : to;
  if (a > b) return 0;
  if (a === l.StartDate && b === l.EndDate) return Number(l.Days) || 0;
  if ((l.Period || 'FULL') !== 'FULL') return 0.5;
  if (CALENDAR_DAY_LEAVE_TYPES_[l.LeaveType]) return daysBetween_(a, b) + 1;
  return countWorkdays_(a, b);
}

/** สรุปใบลาที่ "อนุมัติแล้ว" แยกตามประเภท → { SICK: {times, days}, ... } */
function leaveTotals_(leaves, from, to) {
  var t = {};
  Object.keys(LEAVE_TYPES).forEach(function (k) { t[k] = { times: 0, days: 0 }; });
  leaves.forEach(function (l) {
    if (l.Status !== REQUEST_STATUS.APPROVED || l.EndDate < from || l.StartDate > to || !t[l.LeaveType]) return;
    t[l.LeaveType].times++;
    t[l.LeaveType].days = round_(t[l.LeaveType].days + leaveDaysInRange_(l, from, to), 1);
  });
  return t;
}

/** ปีงบประมาณจาก Browser (พ.ศ.) — ค่าไม่ถูกต้องใช้ปีงบประมาณปัจจุบัน */
function parseFiscalYear_(v) {
  var cur = fiscalYearOf_(todayStr_());
  var fy = parseInt(v, 10);
  return isFinite(fy) && fy >= cur - 20 && fy <= cur + 1 ? fy : cur;
}

/** สถิติการลา/มาสาย/ขาดงานของตนเอง แยกรอบการประเมิน (รอบที่ 1, รอบที่ 2, ทั้งปีงบประมาณ) */
function getMyLeaveStats_(ctx, p) {
  var emp = ctx.user;
  var today = todayStr_();
  var cur = fiscalYearOf_(today);
  var fy = parseFiscalYear_(p.fiscalYear);
  var ranges = [fiscalRange_(fy, 1), fiscalRange_(fy, 2), fiscalRange_(fy, 0)];
  var mine = readAll_('LeaveRequests').filter(function (l) { return l.EmployeeID === emp.EmployeeID; });
  var att = computeAttendance_({ employees: [emp], from: ranges[2].from, to: ranges[2].to });
  var days = att.people.length ? att.people[0].days : [];
  return {
    fiscalYear: fy,
    options: [cur, cur - 1, cur - 2],
    pending: mine.filter(function (l) {
      return l.Status === REQUEST_STATUS.PENDING && l.EndDate >= ranges[2].from && l.StartDate <= ranges[2].to;
    }).length,
    types: Object.keys(LEAVE_TYPES).map(function (k) { return { type: k, label: LEAVE_TYPES[k] }; }),
    rounds: ranges.map(function (r) {
      var late = 0, lateMinutes = 0, absent = 0;
      days.forEach(function (d) {
        if (d.date < r.from || d.date > r.to) return;
        if (d.status === 'LATE') { late++; lateMinutes += d.lateMinutes || 0; }
        if (d.status === 'ABSENT') absent++;
      });
      return {
        round: r.round, label: r.round ? 'รอบที่ ' + r.round : 'ทั้งปีงบประมาณ', shortLabel: r.shortLabel,
        from: r.from, to: r.to, rangeLabel: r.rangeLabel, started: r.from <= today, current: r.from <= today && today <= r.to,
        leaves: leaveTotals_(mine, r.from, r.to), late: late, lateMinutes: Math.round(lateMinutes), absent: absent
      };
    })
  };
}

/**
 * ข้อมูลสำหรับพิมพ์ใบลาตามแบบของทางราชการ
 * (แบบใบลาป่วย ลาคลอดบุตร ลากิจส่วนตัว / แบบใบลาพักผ่อน) พร้อมสถิติการลาในปีงบประมาณจากระบบ
 * ผู้มีสิทธิ์: เจ้าของใบลา, ผู้บริหาร, ผู้ดูแลระบบ
 */
function getLeaveForm_(ctx, p) {
  var l = findOne_('LeaveRequests', 'LeaveID', String(p.leaveId || ''));
  if (!l) throw appError_('ไม่พบใบลา', 'NOT_FOUND');
  var privileged = ctx.user.Role === ROLES.ADMIN || ctx.user.Role === ROLES.EXECUTIVE;
  if (l.EmployeeID !== ctx.user.EmployeeID && !privileged) {
    writeAudit_(ctx, 'ACCESS_DENIED', 'LeaveRequest', l.LeaveID, { reason: 'leave form' });
    throw appError_('คุณไม่มีสิทธิ์เข้าถึงใบลานี้', 'FORBIDDEN');
  }
  var kind = LEAVE_FORM_TYPES_[l.LeaveType];
  if (!kind) throw appError_('ประเภทการลานี้ไม่มีแบบใบลาให้พิมพ์ (พิมพ์ได้เฉพาะลาป่วย ลากิจ ลาคลอดบุตร และลาพักผ่อน)', 'VALIDATION');
  if (!leaveFormAvailable_(l)) throw appError_('ใบลานี้' + (REQUEST_STATUS_LABELS[l.Status] || '') + 'แล้ว จึงพิมพ์ใบลาไม่ได้', 'VALIDATION');
  var s = getSettings_();
  var emp = getEmployeeById_(l.EmployeeID) || { FullName: l.FullName, Position: '' };
  var fy = fiscalYearOf_(l.StartDate);
  var range = fiscalRange_(fy, 0);
  var others = readAll_('LeaveRequests').filter(function (r) {
    return r.EmployeeID === l.EmployeeID && r.LeaveID !== l.LeaveID && r.Status === REQUEST_STATUS.APPROVED;
  });
  // "ลามาแล้ว" = ใบลาที่อนุมัติแล้วในปีงบประมาณเดียวกันที่เริ่มก่อนใบลานี้
  var prev = leaveTotals_(others.filter(function (r) { return r.StartDate < l.StartDate; }), range.from, range.to);
  var thisDays = leaveDaysInRange_(l, range.from, range.to);
  var stats = (kind.form === 'GENERAL' ? ['SICK', 'PERSONAL', 'MATERNITY'] : ['VACATION']).map(function (k) {
    var before = prev[k].days, now = k === l.LeaveType ? thisDays : null;
    return { type: k, label: LEAVE_FORM_TYPES_[k].word, before: before, now: now, total: round_(before + (now || 0), 1) };
  });
  var last = null;
  if (kind.form === 'GENERAL') {
    others.forEach(function (r) {
      var k = LEAVE_FORM_TYPES_[r.LeaveType];
      if (k && k.form === 'GENERAL' && r.EndDate < l.StartDate && (!last || r.EndDate > last.EndDate)) last = r;
    });
  }
  var written = parseYmd_(String(l.RequestedAt || nowStamp_()).substr(0, 10));
  return {
    form: kind.form,
    title: kind.form === 'GENERAL' ? 'แบบใบลาป่วย ลาคลอดบุตร ลากิจส่วนตัว' : 'แบบใบลาพักผ่อน',
    leaveId: l.LeaveID,
    writtenAt: APP.SCHOOL_NAME,
    writtenDay: written.d, writtenMonth: THAI_MONTHS[written.m - 1], writtenYear: written.y + 543,
    subject: 'ขอลา' + kind.word,
    // ผู้อำนวยการลาเอง: เรียนผู้บังคับบัญชาระดับเหนือขึ้นไป (ให้กรอกด้วยลายมือ)
    to: emp.Position === 'ผู้อำนวยการ' ? '' : s.directorPosition,
    fullName: emp.FullName, position: emp.Position || '',
    affiliation: APP.SCHOOL_NAME + (s.affiliation ? ' ' + s.affiliation : ''),
    type: l.LeaveType, word: kind.word,
    reason: l.Reason || '',
    startLabel: thaiDate_(l.StartDate), endLabel: thaiDate_(l.EndDate),
    days: Number(l.Days) || 0,
    periodLabel: l.Period && l.Period !== 'FULL' ? LEAVE_PERIODS[l.Period] : '',
    last: last ? { type: last.LeaveType, startLabel: thaiDate_(last.StartDate), endLabel: thaiDate_(last.EndDate), days: Number(last.Days) || 0 } : null,
    fiscalYear: fy,
    stats: stats,
    director: { name: s.directorName, position: s.directorPosition },
    status: l.Status, statusLabel: REQUEST_STATUS_LABELS[l.Status],
    reviewedByName: l.ReviewedBy === 'AUTO' ? '' : (l.ReviewedByName || ''), reviewedLabel: thaiStamp_(l.ReviewedAt),
    printedAt: thaiStamp_(nowStamp_()),
    school: APP.SCHOOL_FULL
  };
}

/* ========================================================================== */
/*  Correction requests                                                       */
/* ========================================================================== */

function correctionView_(r) {
  return {
    requestId: r.RequestID, employeeId: r.EmployeeID, staffCode: r.StaffCode, fullName: r.FullName,
    date: r.Date, dateLabel: thaiDate_(r.Date), type: r.Type, typeLabel: ATT_TYPES[r.Type],
    time: r.RequestedTime ? r.RequestedTime.substr(0, 5) : '', reason: r.Reason,
    hasAttachment: !!r.AttachmentFileId, attachmentName: r.AttachmentName,
    status: r.Status, statusLabel: REQUEST_STATUS_LABELS[r.Status] || r.Status,
    requestedAt: r.RequestedAt, requestedLabel: thaiStamp_(r.RequestedAt),
    reviewedByName: r.ReviewedByName, reviewedLabel: thaiStamp_(r.ReviewedAt), reviewNote: r.ReviewNote,
    oldAttendanceId: r.OldAttendanceID, newAttendanceId: r.NewAttendanceID,
    recordedBy: r.RecordedBy && r.RecordedBy !== 'SELF' ? r.RecordedBy : ''
  };
}

/** ตรวจวันที่/ประเภท/เวลา ของการแก้ไขเวลา (ใช้ร่วมกันทั้งคำร้องของบุคลากรและการบันทึกแทนโดยผู้บริหาร) */
function validateCorrectionInput_(emp, p, maxBackDays) {
  var date = String(p.date || ''), type = String(p.type || ''), time = String(p.time || ''), today = todayStr_();
  if (!isValidYmd_(date)) throw appError_('กรุณาเลือกวันที่ที่ต้องการแก้ไข', 'VALIDATION', { field: 'date' });
  if (date > today) throw appError_('ไม่สามารถแก้ไขเวลาของวันในอนาคตได้', 'VALIDATION', { field: 'date' });
  if (date < addDays_(today, -maxBackDays)) {
    throw appError_('แก้ไขเวลาย้อนหลังได้ไม่เกิน ' + maxBackDays + ' วัน', 'VALIDATION', { field: 'date' });
  }
  if (emp.ActiveFrom && date < emp.ActiveFrom) throw appError_('วันที่เลือกอยู่ก่อนวันที่บัญชีเริ่มใช้งาน', 'VALIDATION', { field: 'date' });
  if (!ATT_TYPES[type]) throw appError_('กรุณาเลือกประเภท เวลาเข้า หรือ เวลาออก', 'VALIDATION', { field: 'type' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw appError_('กรุณาระบุเวลาให้ถูกต้อง (ชั่วโมง:นาที)', 'VALIDATION', { field: 'time' });
  if (date === today && time + ':00' > nowTimeStr_()) throw appError_('เวลาที่แจ้งต้องไม่เกินเวลาปัจจุบัน', 'VALIDATION', { field: 'time' });
  return { date: date, type: type, time: time };
}

function submitCorrection_(ctx, p) {
  var emp = ctx.user, s = ctx.settings;
  var v = validateCorrectionInput_(emp, p, s.correctionMaxDays);
  var date = v.date, type = v.type, time = v.time;
  var reason = cleanText_(p.reason, 1000);
  if (reason.length < 5) throw appError_('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร', 'VALIDATION', { field: 'reason' });
  if (reason.length > 500) throw appError_('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'VALIDATION', { field: 'reason' });

  var reqId = newId_('CR');
  var att = saveAttachment_(p.attachment, reqId);
  var rec = withAttachmentCleanup_(att, function () { return withLock_(function () {
    var dup = readAll_('CorrectionRequests').some(function (r) {
      return r.EmployeeID === emp.EmployeeID && r.Date === date && r.Type === type && r.Status === 'PENDING';
    });
    if (dup) throw appError_('มีคำร้องแก้ไข' + ATT_TYPES[type] + 'ของวันนี้รอการพิจารณาอยู่แล้ว', 'DUPLICATE');
    var r = {
      RequestID: reqId, EmployeeID: emp.EmployeeID, StaffCode: emp.StaffCode, FullName: emp.FullName,
      Date: date, Type: type, RequestedTime: time + ':00', Reason: reason,
      AttachmentFileId: att ? att.fileId : '', AttachmentName: att ? att.name : '',
      Status: 'PENDING', RequestedAt: nowStamp_(), ReviewedBy: '', ReviewedByName: '', ReviewedAt: '', ReviewNote: '',
      OldAttendanceID: '', NewAttendanceID: '', RecordedBy: 'SELF'
    };
    appendRecord_('CorrectionRequests', r);
    return r;
  }); });
  writeAudit_(ctx, 'CORRECTION_SUBMIT', 'CorrectionRequest', rec.RequestID, { date: date, type: type, time: time });
  return { request: correctionView_(rec), message: 'ส่งคำร้องแก้ไขเวลาเรียบร้อยแล้ว รอการพิจารณา' };
}

function listMyCorrections_(ctx) {
  return readAll_('CorrectionRequests').filter(function (r) { return r.EmployeeID === ctx.user.EmployeeID; })
    .sort(function (a, b) { return a.RequestedAt < b.RequestedAt ? 1 : -1; })
    .slice(0, 100).map(correctionView_);
}

function cancelCorrection_(ctx, p) {
  var rec = withLock_(function () {
    var r = findOne_('CorrectionRequests', 'RequestID', String(p.requestId || ''));
    if (!r || r.EmployeeID !== ctx.user.EmployeeID) throw appError_('ไม่พบคำร้อง', 'NOT_FOUND');
    if (r.Status !== 'PENDING') throw appError_('ยกเลิกได้เฉพาะคำร้องที่รอพิจารณา', 'VALIDATION');
    return updateRecord_('CorrectionRequests', r._row, { Status: 'CANCELLED', ReviewNote: 'ผู้ยื่นยกเลิกเอง', ReviewedAt: nowStamp_() });
  });
  writeAudit_(ctx, 'CORRECTION_CANCEL', 'CorrectionRequest', rec.RequestID, null);
  return { request: correctionView_(rec), message: 'ยกเลิกคำร้องแล้ว' };
}

function adminListCorrections_(ctx, p) {
  var status = String(p.status || 'PENDING');
  var q = cleanLine_(p.q, 60).toLowerCase();
  var rows = readAll_('CorrectionRequests').filter(function (r) {
    if (status !== 'ALL' && r.Status !== status) return false;
    if (q && (r.FullName + ' ' + r.StaffCode).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return a.RequestedAt < b.RequestedAt ? 1 : -1; }).slice(0, 300);
  var sums = {};
  readAll_('DailySummary').forEach(function (s) { sums[s.Key] = s; });
  return rows.map(function (r) {
    var v = correctionView_(r);
    var cur = sums[r.Date + '|' + r.EmployeeID];
    v.currentIn = cur && cur.CheckInTime ? cur.CheckInTime.substr(0, 5) : '';
    v.currentOut = cur && cur.CheckOutTime ? cur.CheckOutTime.substr(0, 5) : '';
    return v;
  });
}

/**
 * พิจารณาคำร้องแก้ไขเวลา — เมื่ออนุมัติ:
 *  1) รายการเดิม (ถ้ามี) → IsActive = FALSE, SupersededBy = รายการใหม่ (ไม่ลบ)
 *  2) เพิ่มรายการใหม่ Source = CORRECTION, RefID = รหัสคำร้อง
 *  3) ปรับ DailySummary และบันทึก Audit Log พร้อมข้อมูลก่อน/หลัง
 */
function reviewCorrection_(ctx, p) {
  var decision = String(p.decision || '');
  if (['APPROVE', 'REJECT'].indexOf(decision) < 0) throw appError_('คำสั่งไม่ถูกต้อง', 'VALIDATION');
  var note = cleanText_(p.note, 500);
  if (decision === 'REJECT' && note.length < 2) throw appError_('กรุณาระบุเหตุผลที่ไม่อนุมัติ', 'VALIDATION', { field: 'note' });
  var out = withLock_(function () {
    var r = findOne_('CorrectionRequests', 'RequestID', String(p.requestId || ''));
    if (!r) throw appError_('ไม่พบคำร้อง', 'NOT_FOUND');
    if (r.EmployeeID === ctx.user.EmployeeID) throw appError_('ไม่สามารถพิจารณาคำร้องของตนเองได้ กรุณาให้ผู้บริหาร/ผู้ดูแลระบบท่านอื่นพิจารณา', 'FORBIDDEN');
    if (r.Status !== 'PENDING') throw appError_('คำร้องนี้ได้รับการพิจารณาแล้ว', 'VALIDATION');
    if (decision === 'REJECT') {
      var rej = updateRecord_('CorrectionRequests', r._row, {
        Status: 'REJECTED', ReviewedBy: ctx.user.EmployeeID, ReviewedByName: ctx.user.FullName, ReviewedAt: nowStamp_(), ReviewNote: note
      });
      return { before: r, after: rej, oldLog: null, newLog: null };
    }
    var applied = applyCorrection_(ctx, r, 'อนุมัติโดย ' + ctx.user.FullName + (note ? ' — ' + note : ''));
    var after = updateRecord_('CorrectionRequests', r._row, {
      Status: 'APPROVED', ReviewedBy: ctx.user.EmployeeID, ReviewedByName: ctx.user.FullName, ReviewedAt: nowStamp_(),
      ReviewNote: note, OldAttendanceID: applied.oldId || '', NewAttendanceID: applied.newId
    });
    return { before: r, after: after, oldLog: applied.oldLog, newLog: applied.newLog };
  });
  writeCorrectionAudit_(ctx, 'CORRECTION_' + decision, out, note);
  return { request: correctionView_(out.after), message: decision === 'APPROVE' ? 'อนุมัติคำร้องและปรับเวลาเรียบร้อยแล้ว' : 'ไม่อนุมัติคำร้องแล้ว' };
}

/**
 * ปรับเวลาตามคำร้อง (เรียกภายใต้ Lock): เพิ่มรายการเวลาใหม่ ทำเครื่องหมายรายการเดิมว่าถูกแทนที่ (ไม่ลบ)
 * และปรับตารางสรุปรายวัน → {oldId, newId, oldLog, newLog}
 */
function applyCorrection_(ctx, r, logNote) {
  var s = ctx.settings;
  var emp = getEmployeeById_(r.EmployeeID);
  if (!emp) throw appError_('ไม่พบข้อมูลบุคลากรของคำร้องนี้', 'NOT_FOUND');
  var summary = findOne_('DailySummary', 'Key', summaryKey_(r.Date, r.EmployeeID));
  var time = normTime_(r.RequestedTime);
  if (r.Type === 'OUT' && summary && summary.CheckInTime && time <= summary.CheckInTime) {
    throw appError_('เวลาออกที่ขอแก้ไข (' + time.substr(0, 5) + ') ต้องหลังเวลาเข้างาน (' + summary.CheckInTime.substr(0, 5) + ')', 'VALIDATION');
  }
  if (r.Type === 'IN' && summary && summary.CheckOutTime && time >= summary.CheckOutTime) {
    throw appError_('เวลาเข้าที่ขอแก้ไข (' + time.substr(0, 5) + ') ต้องก่อนเวลาออกงาน (' + summary.CheckOutTime.substr(0, 5) + ')', 'VALIDATION');
  }
  var dayInfo = getDayInfo_(r.Date, s);
  var st = computeLogStatus_(r.Type, time, dayInfo, s);
  var newId = newId_(r.Type === 'IN' ? 'IN' : 'OUT');
  var oldId = summary ? (r.Type === 'IN' ? summary.CheckInLogID : summary.CheckOutLogID) : '';
  var oldLog = null;
  if (oldId) {
    oldLog = findOne_('AttendanceLogs', 'AttendanceID', oldId);
    if (oldLog) {
      updateRecord_('AttendanceLogs', oldLog._row, {
        IsActive: false, SupersededBy: newId,
        Note: (oldLog.Note ? oldLog.Note + ' | ' : '') + 'ถูกแทนที่ตามคำร้อง ' + r.RequestID
      });
    }
  }
  var newLog = {
    AttendanceID: newId, EmployeeID: emp.EmployeeID, StaffCode: emp.StaffCode, FullName: emp.FullName,
    Type: r.Type, Date: r.Date, Time: time, Timestamp: nowStamp_(),
    Latitude: '', Longitude: '', Accuracy: '', DistanceM: '',
    Status: st.status, Source: 'CORRECTION', IsActive: true, SupersededBy: '', RefID: r.RequestID,
    Note: logNote
  };
  appendRecord_('AttendanceLogs', newLog);
  var patch = { DayType: dayInfo.isWorkday ? 'WORKDAY' : 'HOLIDAY', Corrected: true };
  if (r.Type === 'IN') {
    patch.CheckInTime = time; patch.CheckInLogID = newId; patch.InDistanceM = null;
    patch.IsLate = st.isLate; patch.LateMinutes = st.lateMinutes;
  } else {
    patch.CheckOutTime = time; patch.CheckOutLogID = newId; patch.OutDistanceM = null; patch.EarlyLeave = st.early;
  }
  upsertDailySummary_(r.Date, emp, patch);
  return { oldId: oldId, newId: newId, oldLog: oldLog, newLog: newLog };
}

function writeCorrectionAudit_(ctx, action, out, note) {
  writeAudit_(ctx, action, 'CorrectionRequest', out.after.RequestID, {
    employee: out.after.FullName, date: out.after.Date, type: out.after.Type, requestedTime: out.after.RequestedTime,
    oldRecord: out.oldLog ? { id: out.oldLog.AttendanceID, time: out.oldLog.Time, status: out.oldLog.Status, source: out.oldLog.Source } : null,
    newRecord: out.newLog ? { id: out.newLog.AttendanceID, time: out.newLog.Time, status: out.newLog.Status } : null,
    note: note
  });
}

/**
 * ผู้บริหาร/ผู้ดูแลระบบ "บันทึกเวลาแทน" บุคลากรที่ลืมลงเวลา (เช่น ครูโทรมาแจ้ง) → มีผลทันที
 * - เก็บเป็นคำร้องที่อนุมัติแล้ว (ผู้บันทึก = ผู้อนุมัติ) รายการเวลาเดิมไม่ถูกลบ + Audit Log
 * - บันทึกให้ตนเองไม่ได้ (ต้องยื่นคำร้องให้ผู้อื่นอนุมัติ) · ย้อนหลังได้ไม่เกิน 1 ปี
 * - ถ้ามีคำร้องของวัน/ประเภทเดียวกันรออยู่ ให้พิจารณาคำร้องนั้นแทน
 */
function adminRecordCorrection_(ctx, p) {
  var emp = getEmployeeById_(String(p.employeeId || ''));
  if (!emp) throw appError_('กรุณาเลือกบุคลากร', 'VALIDATION', { field: 'employeeId' });
  if (emp.Status !== EMP_STATUS.ACTIVE) throw appError_('บัญชีนี้ไม่ได้อยู่ในสถานะใช้งาน', 'VALIDATION', { field: 'employeeId' });
  if (emp.EmployeeID === ctx.user.EmployeeID) {
    throw appError_('บันทึกเวลาให้ตนเองไม่ได้ กรุณายื่นคำร้องแก้ไขเวลาเพื่อให้ผู้บริหาร/ผู้ดูแลท่านอื่นอนุมัติ', 'FORBIDDEN');
  }
  var v = validateCorrectionInput_(emp, p, 366);
  var reason = cleanText_(p.reason, 1000);
  if (reason.length < 2) throw appError_('กรุณาระบุเหตุผล เช่น ครูแจ้งว่าลืมลงเวลา', 'VALIDATION', { field: 'reason' });
  if (reason.length > 500) throw appError_('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'VALIDATION', { field: 'reason' });
  var out = withLock_(function () {
    var dup = readAll_('CorrectionRequests').some(function (r) {
      return r.EmployeeID === emp.EmployeeID && r.Date === v.date && r.Type === v.type && r.Status === 'PENDING';
    });
    if (dup) throw appError_('มีคำร้องแก้ไข' + ATT_TYPES[v.type] + 'ของวันนี้รอการพิจารณาอยู่แล้ว กรุณาพิจารณาที่เมนู “คำร้องแก้ไขเวลา”', 'DUPLICATE');
    var now = nowStamp_();
    var r = {
      RequestID: newId_('CR'), EmployeeID: emp.EmployeeID, StaffCode: emp.StaffCode, FullName: emp.FullName,
      Date: v.date, Type: v.type, RequestedTime: v.time + ':00', Reason: reason,
      AttachmentFileId: '', AttachmentName: '', Status: 'APPROVED', RequestedAt: now,
      ReviewedBy: ctx.user.EmployeeID, ReviewedByName: ctx.user.FullName, ReviewedAt: now, ReviewNote: 'บันทึกเวลาแทนโดย ' + ctx.user.FullName,
      OldAttendanceID: '', NewAttendanceID: '', RecordedBy: ctx.user.FullName
    };
    var applied = applyCorrection_(ctx, r, 'บันทึกแทนโดย ' + ctx.user.FullName + ' — ' + reason);
    r.OldAttendanceID = applied.oldId || '';
    r.NewAttendanceID = applied.newId;
    appendRecord_('CorrectionRequests', r);
    return { after: r, oldLog: applied.oldLog, newLog: applied.newLog };
  });
  writeCorrectionAudit_(ctx, 'CORRECTION_RECORD_BY_ADMIN', out, reason);
  return {
    request: correctionView_(out.after),
    message: 'บันทึกเวลา' + ATT_TYPES[v.type] + 'ของ ' + emp.FullName + ' วันที่ ' + thaiDate_(v.date, 'short') + ' เวลา ' + v.time + ' น. เรียบร้อย'
  };
}

/* ======================================================================
 * Admin.gs
 * ====================================================================== */
/**
 * ============================================================================
 *  Admin.gs — Dashboard ผู้บริหาร/ผู้ดูแลระบบ, จัดการสมาชิก, ตั้งค่า, ปฏิทิน, Audit Log
 * ============================================================================
 *  ทุกฟังก์ชันในไฟล์นี้ถูกเรียกผ่าน api() เท่านั้น ซึ่งตรวจสอบ Session + Role
 *  ฝั่ง Server ก่อนทุกครั้ง (ดูตาราง getRoutes_ ใน Code.gs)
 * ============================================================================
 */

/** ส่ง HTML + JavaScript ของหน้า Admin ให้เฉพาะผู้บริหาร/ผู้ดูแลระบบ */
function getAdminView_(ctx) {
  var html, script = '';
  try {
    // ชุดติดตั้งแบบง่าย (dist/): หน้า Admin รวมอยู่ในไฟล์ Admin.html ไฟล์เดียว
    html = HtmlService.createHtmlOutputFromFile('Admin').getContent();
  } catch (e) {
    html = HtmlService.createHtmlOutputFromFile('AdminDashboard').getContent();
    script = HtmlService.createHtmlOutputFromFile('AdminScript').getContent();
  }
  return {
    html: html,
    script: script,
    role: ctx.user.Role,
    roleLabel: ROLE_LABELS[ctx.user.Role]
  };
}

/* ========================================================================== */
/*  Overview                                                                  */
/* ========================================================================== */

/**
 * รายการตั้งค่าเริ่มต้นที่ควรทำให้ครบ (แสดงบนหน้าภาพรวมของผู้ดูแลระบบจนกว่าจะครบ)
 * ตรวจจากข้อมูลจริงทั้งหมด ไม่ต้องติ๊กเอง
 */
function setupChecklist_(s, allEmps, today) {
  var active = allEmps.filter(function (e) { return e.Status === EMP_STATUS.ACTIVE; });
  var activeIds = {};
  active.forEach(function (e) { if (e.Role !== ROLES.ADMIN) activeIds[e.EmployeeID] = true; });
  var y = +today.substr(0, 4);
  var schoolBreak = readAll_('WorkCalendar').some(function (c) {
    return c.Type === 'SPECIAL_HOLIDAY' && (+String(c.Date).substr(0, 4) === y || +String(c.Date).substr(0, 4) === y + 1);
  });
  var items = [
    { key: 'geo', done: s.geofenceConfigured, sec: 'settings', title: 'ตั้งพิกัดโรงเรียน', hint: 'ไปที่โรงเรียนแล้วกด “ใช้ตำแหน่งปัจจุบันของฉัน” ในหน้าตั้งค่า' },
    { key: 'confirm', done: s.settingsConfirmed, sec: 'settings', title: 'ตรวจเวลาทำงานแล้วกดยืนยัน', hint: 'เวลาเริ่มงาน / ถือว่าสาย / เลิกงาน ให้ตรงกับคำสั่งของโรงเรียน' },
    { key: 'director', done: !!s.directorName, sec: 'settings', title: 'ใส่ชื่อผู้อำนวยการ', hint: 'ใช้ในช่องลงนามของใบลาและรายงาน' },
    { key: 'break', done: schoolBreak, sec: 'calendar', title: 'เพิ่มวันปิดภาคเรียน/วันหยุดของโรงเรียน', hint: 'ถ้าไม่เพิ่ม ช่วงปิดภาคเรียนครูทุกคนจะถูกนับว่าขาดงาน' },
    { key: 'staff', done: Object.keys(activeIds).length > 0, sec: 'share', title: 'เพิ่มครูและบุคลากร', hint: 'วางรายชื่อจาก Excel แล้วพิมพ์บัตรเข้าใช้งาน หรือส่งลิงก์ให้สมัครเอง' },
    { key: 'firstUse', done: readAll_('DailySummary').some(function (g) { return activeIds[g.EmployeeID]; }), sec: 'share', title: 'ครูเริ่มลงเวลา', hint: 'ติดประกาศ QR Code ที่ห้องพักครู หรือส่งข้อความในกลุ่ม LINE' }
  ];
  var done = items.filter(function (i) { return i.done; }).length;
  return { items: items, done: done, total: items.length, complete: done === items.length };
}

function getAdminOverview_(ctx) {
  var s = ctx.settings;
  var today = todayStr_();
  var emps = getActiveEmployees_().filter(function (e) { return e.ActiveFrom && e.ActiveFrom <= today; });
  var res = computeAttendance_({ employees: emps, from: today, to: today });
  var c = { total: 0, present: 0, onTime: 0, late: 0, leave: 0, absent: 0, notYet: 0, incomplete: 0, inProgress: 0, holidayWork: 0 };
  var list = [];
  res.people.forEach(function (pp) {
    var d = pp.days[0];
    if (!d) return;
    c.total++;
    if (d.status === 'PRESENT' || d.status === 'LATE') c.present++;
    if (d.status === 'PRESENT') c.onTime++;
    if (d.status === 'LATE') c.late++;
    if (d.leave) c.leave++;
    if (d.status === 'ABSENT') c.absent++;
    if (d.status === 'NOT_YET') c.notYet++;
    if (d.missingIn || d.missingOut) c.incomplete++;
    if (d.inProgress) c.inProgress++;
    if (d.status === 'HOLIDAY_WORK') c.holidayWork++;
    list.push({
      employeeId: pp.emp.employeeId, staffCode: pp.emp.staffCode, fullName: pp.emp.fullName, position: pp.emp.position,
      checkIn: d.checkIn ? d.checkIn.substr(0, 5) : '', checkOut: d.checkOut ? d.checkOut.substr(0, 5) : '',
      status: d.status, statusLabel: d.statusLabel, note: d.note, lateMinutes: d.lateMinutes, missingOut: d.missingOut
    });
  });
  list.sort(function (a, b) {
    if (a.checkIn && b.checkIn) return a.checkIn < b.checkIn ? 1 : -1;
    if (a.checkIn) return -1;
    if (b.checkIn) return 1;
    return String(a.staffCode).localeCompare(String(b.staffCode), 'th', { numeric: true });
  });
  // แนวโน้ม 7 วันทำงานล่าสุด
  var trendRes = computeAttendance_({ employees: emps, from: addDays_(today, -20), to: today });
  var workdates = trendRes.dates.filter(function (d) { return trendRes.infos[d].isWorkday; }).slice(-7);
  var trend = { labels: [], onTime: [], late: [], leave: [], absent: [] };
  workdates.forEach(function (date) {
    var t = { onTime: 0, late: 0, leave: 0, absent: 0 };
    trendRes.people.forEach(function (pp) {
      pp.days.forEach(function (d) {
        if (d.date !== date) return;
        if (d.status === 'PRESENT') t.onTime++;
        else if (d.status === 'LATE') t.late++;
        else if (d.status === 'LEAVE') t.leave++;
        else if (d.status === 'ABSENT') t.absent++;
      });
    });
    trend.labels.push(thaiDate_(date, 'short').replace(/ \d+$/, ''));
    trend.onTime.push(t.onTime); trend.late.push(t.late); trend.leave.push(t.leave); trend.absent.push(t.absent);
  });
  var allEmps = getEmployees_();
  var warnings = [];
  if (!s.geofenceConfigured) warnings.push('ยังไม่ได้ตั้งค่าพิกัดโรงเรียน บุคลากรจะยังไม่สามารถลงเวลาได้');
  // ผู้ดูแลระบบเห็นรายการนี้ในการ์ด "ตั้งค่าเริ่มต้นให้ครบ" แล้ว
  if (!s.settingsConfirmed && ctx.user.Role !== ROLES.ADMIN) warnings.push('การตั้งค่าเวลาทำงาน/รัศมี GPS ยังเป็นค่าตัวอย่าง กรุณาตรวจสอบให้ตรงกับระเบียบของโรงเรียนแล้วกดยืนยันในหน้าตั้งค่า');
  var storage = driveStorageInfo_();
  if (storage && storage.percent >= 85) {
    warnings.push('พื้นที่ Google Drive ของบัญชีระบบใช้ไปแล้ว ' + storage.percent + '% (' + storage.usedLabel + ' จาก ' + storage.limitLabel +
      ') หากเต็ม ระบบจะบันทึกการลงเวลาไม่ได้ กรุณาลบไฟล์ที่ไม่ใช้/ล้างถังขยะ/ลบอีเมลเก่า หรือเพิ่มพื้นที่');
  }
  var info = getDayInfo_(today, s);
  return {
    setup: ctx.user.Role === ROLES.ADMIN ? setupChecklist_(s, allEmps, today) : null,
    announcement: getAnnouncement_(),
    approvals: approvalCounts_(ctx.user),
    date: today,
    dateLabel: thaiDate_(today, 'long'),
    isWorkday: info.isWorkday,
    holidayName: info.holidayName,
    serverNow: nowMs_(),
    workEnd: s.workEnd,
    counts: c,
    storage: storage,
    pending: {
      registrations: allEmps.filter(function (e) { return e.Status === EMP_STATUS.PENDING; }).length,
      leaves: readAll_('LeaveRequests').filter(function (r) { return r.Status === 'PENDING'; }).length,
      corrections: readAll_('CorrectionRequests').filter(function (r) { return r.Status === 'PENDING'; }).length,
      passwordResets: ctx.user.Role === ROLES.ADMIN ? allEmps.filter(function (e) { return e.Status === EMP_STATUS.ACTIVE && e.ResetRequestedAt; }).length : 0
    },
    totalStaff: allEmps.filter(function (e) { return e.Status === EMP_STATUS.ACTIVE; }).length,
    trend: trend,
    today: list,
    warnings: warnings
  };
}

/** พื้นที่ Google Drive ของบัญชีที่ใช้ติดตั้งระบบ (ใช้ร่วมกับ Gmail/Google Photos) */
function driveStorageInfo_() {
  try {
    var used = DriveApp.getStorageUsed(), limit = DriveApp.getStorageLimit();
    if (!limit || limit <= 0) return null; // ไม่จำกัด (เช่น บางบัญชีองค์กร)
    function gb(b) { return round_(b / Math.pow(1024, 3), 2) + ' GB'; }
    return { used: used, limit: limit, percent: Math.round(used / limit * 100), usedLabel: gb(used), limitLabel: gb(limit) };
  } catch (e) {
    return null;
  }
}

/* ========================================================================== */
/*  Members                                                                   */
/* ========================================================================== */

function employeeView_(e, locked) {
  return {
    employeeId: e.EmployeeID, staffCode: e.StaffCode, fullName: e.FullName, position: e.Position,
    username: e.Username, role: e.Role, roleLabel: ROLE_LABELS[e.Role] || e.Role,
    status: e.Status, statusLabel: EMP_STATUS_LABELS[e.Status] || e.Status,
    mustChangePassword: !!e.MustChangePassword,
    activeFrom: e.ActiveFrom, activeFromLabel: e.ActiveFrom ? thaiDate_(e.ActiveFrom, 'short') : '',
    activeTo: e.ActiveTo,
    createdLabel: thaiStamp_(e.CreatedAt), createdBy: e.CreatedBy,
    approvedBy: e.ApprovedBy, approvedLabel: thaiStamp_(e.ApprovedAt),
    lastLoginLabel: thaiStamp_(e.LastLoginAt), note: e.Note,
    resetRequested: !!e.ResetRequestedAt, resetRequestedLabel: thaiStamp_(e.ResetRequestedAt), resetNote: e.ResetRequestNote || '',
    locked: !!locked
  };
}

function listEmployeesBasic_(ctx) {
  return getEmployees_().filter(function (e) { return e.Status === EMP_STATUS.ACTIVE || e.Status === EMP_STATUS.INACTIVE; })
    .sort(function (a, b) { return String(a.StaffCode).localeCompare(String(b.StaffCode), 'th', { numeric: true }); })
    .map(function (e) {
      return { employeeId: e.EmployeeID, staffCode: e.StaffCode, fullName: e.FullName, position: e.Position, status: e.Status };
    });
}

function listEmployees_(ctx, p) {
  var q = cleanLine_(p.q, 60).toLowerCase();
  var status = String(p.status || 'ALL');
  var role = String(p.role || 'ALL');
  var list = getEmployees_().filter(function (e) {
    if (status !== 'ALL' && e.Status !== status) return false;
    if (role !== 'ALL' && e.Role !== role) return false;
    if (q && (e.FullName + ' ' + e.StaffCode + ' ' + e.Username).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    if (a.Status !== b.Status) return a.Status === 'PENDING' ? -1 : (b.Status === 'PENDING' ? 1 : (a.Status < b.Status ? -1 : 1));
    return String(a.StaffCode).localeCompare(String(b.StaffCode), 'th', { numeric: true });
  });
  var keys = list.map(function (e) { return loginFailKey_(e.Username); });
  var states = keys.length ? CacheService.getScriptCache().getAll(keys) : {};
  return list.map(function (e, i) {
    var raw = states[keys[i]];
    var locked = false;
    if (raw) { try { locked = JSON.parse(raw).lockedUntil > nowMs_(); } catch (x) { locked = false; } }
    return employeeView_(e, locked);
  });
}

function requireTargetEmployee_(id) {
  var e = findOne_('Employees', 'EmployeeID', String(id || ''));
  if (!e) throw appError_('ไม่พบข้อมูลบุคลากร', 'NOT_FOUND');
  return e;
}

function assertNotSelf_(ctx, target, what) {
  if (target.EmployeeID === ctx.user.EmployeeID) throw appError_('ไม่สามารถ' + what + 'บัญชีของตนเองได้', 'FORBIDDEN');
}

/** ต้องเหลือผู้ดูแลระบบที่ใช้งานอย่างน้อย 1 คน */
function assertKeepsAnAdmin_(targetId) {
  var others = readAll_('Employees').filter(function (e) {
    return e.EmployeeID !== targetId && e.Role === ROLES.ADMIN && e.Status === EMP_STATUS.ACTIVE;
  });
  if (!others.length) throw appError_('ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน', 'FORBIDDEN');
}

function snapshotEmployee_(e) {
  return {
    staffCode: e.StaffCode, fullName: e.FullName, position: e.Position, username: e.Username,
    role: e.Role, status: e.Status, activeFrom: e.ActiveFrom, activeTo: e.ActiveTo
  };
}

function validRole_(r) {
  if (!ROLES[r]) throw appError_('ประเภทผู้ใช้งานไม่ถูกต้อง', 'VALIDATION', { field: 'role' });
  return r;
}

/** เพิ่มสมาชิกโดยผู้ดูแลระบบ — ระบบสุ่มรหัสผ่านชั่วคราว (แสดงครั้งเดียว) และบังคับเปลี่ยนเมื่อเข้าสู่ระบบ */
function createEmployee_(ctx, p) {
  var data = validateEmployeeInput_(p, { requirePassword: false, autoCode: true });
  var role = validRole_(String(p.role || ROLES.USER));
  var temp = generateTempPassword_(12);
  var hash = hashPassword_(temp);
  var rec = withLock_(function () {
    if (!data.staffCode) data.staffCode = nextStaffCode_();
    assertUniqueEmployee_(data.username, data.staffCode, null);
    var r = {
      EmployeeID: newId_('EMP'), StaffCode: data.staffCode, FullName: data.fullName, Position: data.position,
      Username: data.username, PasswordHash: hash, Role: role, Status: EMP_STATUS.ACTIVE,
      MustChangePassword: true, SessionVersion: 1, ActiveFrom: todayStr_(), ActiveTo: '',
      CreatedAt: nowStamp_(), CreatedBy: ctx.user.FullName, UpdatedAt: nowStamp_(),
      ApprovedBy: ctx.user.FullName, ApprovedAt: nowStamp_(), LastLoginAt: '', Note: cleanLine_(p.note, 200)
    };
    appendRecord_('Employees', r);
    return r;
  });
  writeAudit_(ctx, 'EMPLOYEE_CREATE', 'Employee', rec.EmployeeID, snapshotEmployee_(rec));
  return {
    employee: employeeView_(rec, false),
    tempPassword: temp,
    message: 'เพิ่มบุคลากรเรียบร้อย กรุณาแจ้งรหัสผ่านชั่วคราวแก่เจ้าของบัญชีโดยตรง (แสดงเพียงครั้งเดียว)'
  };
}

/* ---------- เพิ่มบุคลากรหลายคนพร้อมกัน (วางรายชื่อจาก Excel) ---------- */

/** แปลงชื่อตำแหน่งที่พิมพ์มา (เช่น ครูชำนาญการ, ธุรการ) เป็นตำแหน่งในระบบ */
function mapPosition_(raw) {
  var t = cleanLine_(raw, 60);
  if (!t) return 'ครู';
  if (POSITIONS.indexOf(t) >= 0) return t;
  if (/^(ผู้อำนวยการ|ผอ\.?)/.test(t)) return 'ผู้อำนวยการ';
  if (/ครู/.test(t)) return 'ครู';
  if (/ธุรการ|บุคลากร|การเงิน|พัสดุ|บรรณารักษ์|รองผู้อำนวยการ/.test(t)) return 'บุคลากรทางการศึกษา';
  return 'เจ้าหน้าที่อื่น ๆ';
}

/** สร้างชื่อผู้ใช้จากรหัสบุคลากร (เช่น T001 → t001, 1234 → t1234) ไม่ซ้ำกับ taken */
function suggestUsername_(staffCode, taken) {
  var b = String(staffCode || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!/^[a-z]/.test(b)) b = 't' + b;
  if (b.length < 4) b = 'user' + b;
  b = b.substr(0, 26);
  var u = b, n = 2;
  while (taken[u]) u = b + '.' + (n++);
  taken[u] = true;
  return u;
}

/** รหัสผ่านชั่วคราว (สุ่ม 12 ตัว) ใช้รอบ PBKDF2 น้อยลงเพื่อสร้างหลายบัญชีได้เร็ว — ระบบบังคับเปลี่ยนรหัสเมื่อเข้าครั้งแรก */
var BULK_TEMP_ITERATIONS_ = 20000;

/**
 * เพิ่มบุคลากรหลายคน: ตรวจทุกแถวก่อน ถ้ามีแถวผิดจะไม่สร้างบัญชีใดเลย (แก้แล้วส่งใหม่ได้ทันที)
 * @param {{rows: Array<{staffCode, fullName, position}>, role?: string}} p
 */
function bulkCreateEmployees_(ctx, p) {
  var rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) throw appError_('กรุณาวางรายชื่อบุคลากรอย่างน้อย 1 คน', 'VALIDATION');
  if (rows.length > 50) throw appError_('เพิ่มได้ครั้งละไม่เกิน 50 คน กรุณาแบ่งส่งเป็นหลายครั้ง', 'VALIDATION');
  var role = validRole_(String(p.role || ROLES.USER));
  var existing = readAll_('Employees');
  var takenUser = {}, takenCode = {};
  existing.forEach(function (e) { takenUser[normalizeUsername_(e.Username)] = true; takenCode[normalizeStaffCode_(e.StaffCode)] = 'มีในระบบแล้ว'; });
  var errors = [], items = [];
  rows.forEach(function (r, i) {
    r = r || {};
    try {
      var code = normalizeStaffCode_(r.staffCode);
      if (code && takenCode[code]) throw appError_('รหัสบุคลากร ' + code + ' ' + (takenCode[code] === true ? 'ซ้ำในรายการ' : takenCode[code]), 'DUPLICATE');
      var data = validateEmployeeInput_({ fullName: r.fullName, staffCode: code, position: mapPosition_(r.position), username: 'placeholder' }, { autoCode: true });
      if (!data.staffCode) data.staffCode = nextStaffCode_(takenCode);
      data.username = suggestUsername_(data.staffCode, takenUser);
      takenCode[data.staffCode] = true;
      items.push(data);
    } catch (e) {
      errors.push({ line: i + 1, message: e.message || String(e) });
    }
  });
  if (errors.length) {
    throw appError_('ข้อมูลไม่ถูกต้อง ' + errors.length + ' แถว — ยังไม่ได้สร้างบัญชีใด ๆ กรุณาแก้ไขแล้วกดใหม่', 'VALIDATION', { rows: errors });
  }
  items.forEach(function (it) {
    it.temp = generateTempPassword_(12);
    it.hash = hashPassword_(it.temp, Math.min(getConfiguredIterations_(), BULK_TEMP_ITERATIONS_));
  });
  var recs = withLock_(function () {
    // ตรวจซ้ำอีกครั้งภายใต้ Lock (กันการสมัครพร้อมกัน)
    items.forEach(function (it) { assertUniqueEmployee_(it.username, it.staffCode, null); });
    var now = nowStamp_(), today = todayStr_();
    var list = items.map(function (it) {
      return {
        EmployeeID: newId_('EMP'), StaffCode: it.staffCode, FullName: it.fullName, Position: it.position,
        Username: it.username, PasswordHash: it.hash, Role: role, Status: EMP_STATUS.ACTIVE,
        MustChangePassword: true, SessionVersion: 1, ActiveFrom: today, ActiveTo: '',
        CreatedAt: now, CreatedBy: ctx.user.FullName, UpdatedAt: now,
        ApprovedBy: ctx.user.FullName, ApprovedAt: now, LastLoginAt: '', Note: 'เพิ่มแบบหลายคน'
      };
    });
    appendRecords_('Employees', list);
    return list;
  });
  writeAudit_(ctx, 'EMPLOYEE_BULK_CREATE', 'Employee', '', {
    count: recs.length, role: role, staff: recs.map(function (r) { return r.StaffCode + ' ' + r.FullName; })
  });
  return {
    created: recs.map(function (r, i) {
      return { employeeId: r.EmployeeID, staffCode: r.StaffCode, fullName: r.FullName, position: r.Position, username: r.Username, tempPassword: items[i].temp };
    }),
    message: 'เพิ่มบุคลากร ' + recs.length + ' คนเรียบร้อย — พิมพ์บัตรเข้าใช้งานหรือคัดลอกรหัสผ่านชั่วคราวก่อนปิดหน้าต่าง (แสดงครั้งเดียว)'
  };
}

/* ---------- ประกาศถึงบุคลากร (แสดงบนหน้าแรกของทุกคน) ---------- */

/** ประกาศที่ยังไม่หมดอายุ หรือ null (เก็บใน Script Properties — ไม่ต้องอ่านชีตเพิ่ม) */
function getAnnouncement_() {
  var raw = scriptProps_().ANNOUNCEMENT;
  if (!raw) return null;
  var a;
  try { a = JSON.parse(raw); } catch (e) { return null; }
  if (!a || !a.text || (a.until && a.until < todayStr_())) return null;
  return { id: a.id, text: a.text, until: a.until, untilLabel: thaiDate_(a.until), by: a.by, atLabel: thaiStamp_(a.at) };
}

/** ผู้บริหาร/ผู้ดูแลระบบประกาศข้อความถึงบุคลากรทุกคน (แทนประกาศเดิม) */
function saveAnnouncement_(ctx, p) {
  var text = cleanText_(p.text, 1000);
  if (text.length < 2) throw appError_('กรุณาพิมพ์ข้อความประกาศ', 'VALIDATION', { field: 'text' });
  if (text.length > 300) throw appError_('ข้อความประกาศต้องไม่เกิน 300 ตัวอักษร', 'VALIDATION', { field: 'text' });
  var until = String(p.until || ''), today = todayStr_();
  if (!isValidYmd_(until)) throw appError_('กรุณาเลือกวันสุดท้ายที่แสดงประกาศ', 'VALIDATION', { field: 'until' });
  if (until < today) throw appError_('วันสุดท้ายที่แสดงต้องไม่ก่อนวันนี้', 'VALIDATION', { field: 'until' });
  if (until > addDays_(today, 90)) throw appError_('แสดงประกาศได้นานไม่เกิน 90 วัน', 'VALIDATION', { field: 'until' });
  var a = { id: newId_('AN'), text: text, until: until, by: ctx.user.FullName, at: nowStamp_() };
  PropertiesService.getScriptProperties().setProperty('ANNOUNCEMENT', JSON.stringify(a));
  MEMO_.props = null;
  writeAudit_(ctx, 'ANNOUNCEMENT_SAVE', 'Announcement', a.id, { text: text, until: until });
  return { announcement: getAnnouncement_(), message: 'ประกาศแล้ว — บุคลากรจะเห็นบนหน้าแรกถึงวันที่ ' + thaiDate_(until) };
}

function clearAnnouncement_(ctx) {
  var cur = getAnnouncement_();
  PropertiesService.getScriptProperties().deleteProperty('ANNOUNCEMENT');
  MEMO_.props = null;
  writeAudit_(ctx, 'ANNOUNCEMENT_CLEAR', 'Announcement', cur ? cur.id : '', cur ? { text: cur.text } : null);
  return { announcement: null, message: 'ลบประกาศแล้ว' };
}

/* ---------- สำรองฐานข้อมูล ---------- */

function backupNow_(ctx) {
  var r = backupDatabase_();
  writeAudit_(ctx, 'BACKUP', 'SYSTEM', '', r);
  return { backup: backupInfo_(), message: 'สำรองข้อมูลแล้ว (' + r.name + ') — เก็บไว้ ' + r.kept + ' ชุดล่าสุด' };
}

/** ลิงก์เว็บแอปสำหรับแชร์/ทำ QR Code (ใช้ /exec เสมอ) */
function getAppLink_(ctx) {
  var url = '';
  try { url = String(ScriptApp.getService().getUrl() || ''); } catch (e) { url = ''; }
  url = url.replace(/\/dev(\?.*)?$/, '/exec');
  return { url: url, school: APP.SCHOOL_FULL, nameTh: APP.NAME_TH, allowRegistration: ctx.settings.allowRegistration };
}

function updateEmployee_(ctx, p) {
  var data = validateEmployeeInput_(p, { requirePassword: false });
  var note = p.note !== undefined ? cleanLine_(p.note, 200) : undefined;
  var out = withLock_(function () {
    var e = requireTargetEmployee_(p.employeeId);
    assertUniqueEmployee_(data.username, data.staffCode, e.EmployeeID);
    var patch = {
      StaffCode: data.staffCode, FullName: data.fullName, Position: data.position, Username: data.username, UpdatedAt: nowStamp_()
    };
    if (note !== undefined) patch.Note = note;
    return { before: e, after: updateRecord_('Employees', e._row, patch) };
  });
  writeAudit_(ctx, 'EMPLOYEE_UPDATE', 'Employee', out.after.EmployeeID, {
    before: snapshotEmployee_(out.before), after: snapshotEmployee_(out.after)
  });
  return { employee: employeeView_(out.after, false), message: 'บันทึกข้อมูลบุคลากรแล้ว' };
}

function setEmployeeStatus_(ctx, p) {
  var status = String(p.status || '');
  if (status !== EMP_STATUS.ACTIVE && status !== EMP_STATUS.INACTIVE) throw appError_('สถานะไม่ถูกต้อง', 'VALIDATION');
  var out = withLock_(function () {
    var e = requireTargetEmployee_(p.employeeId);
    assertNotSelf_(ctx, e, 'เปลี่ยนสถานะ');
    if (e.Status === EMP_STATUS.PENDING || e.Status === EMP_STATUS.REJECTED) {
      throw appError_('บัญชีนี้ยังไม่ผ่านการอนุมัติ กรุณาใช้เมนูอนุมัติสมาชิก', 'VALIDATION');
    }
    if (status === EMP_STATUS.INACTIVE && e.Role === ROLES.ADMIN) assertKeepsAnAdmin_(e.EmployeeID);
    var patch = { Status: status, UpdatedAt: nowStamp_(), SessionVersion: (Number(e.SessionVersion) || 0) + 1 };
    if (status === EMP_STATUS.INACTIVE) patch.ActiveTo = todayStr_();
    else { patch.ActiveTo = ''; if (!e.ActiveFrom) patch.ActiveFrom = todayStr_(); }
    return { before: e, after: updateRecord_('Employees', e._row, patch) };
  });
  writeAudit_(ctx, status === EMP_STATUS.ACTIVE ? 'EMPLOYEE_ACTIVATE' : 'EMPLOYEE_DEACTIVATE', 'Employee', out.after.EmployeeID,
    { before: out.before.Status, after: out.after.Status });
  return { employee: employeeView_(out.after, false), message: status === EMP_STATUS.ACTIVE ? 'เปิดใช้งานบัญชีแล้ว' : 'ปิดใช้งานบัญชีแล้ว (ผู้ใช้ถูกออกจากระบบทันที)' };
}

function setEmployeeRole_(ctx, p) {
  var role = validRole_(String(p.role || ''));
  var out = withLock_(function () {
    var e = requireTargetEmployee_(p.employeeId);
    assertNotSelf_(ctx, e, 'เปลี่ยนประเภทผู้ใช้งานของ');
    if (e.Role === ROLES.ADMIN && role !== ROLES.ADMIN) assertKeepsAnAdmin_(e.EmployeeID);
    return { before: e, after: updateRecord_('Employees', e._row, { Role: role, UpdatedAt: nowStamp_() }) };
  });
  writeAudit_(ctx, 'EMPLOYEE_ROLE_CHANGE', 'Employee', out.after.EmployeeID, { before: out.before.Role, after: out.after.Role });
  return { employee: employeeView_(out.after, false), message: 'เปลี่ยนประเภทผู้ใช้งานเป็น ' + ROLE_LABELS[role] + ' แล้ว' };
}

function approveRegistration_(ctx, p) {
  var role = validRole_(String(p.role || ROLES.USER));
  var out = withLock_(function () {
    var e = requireTargetEmployee_(p.employeeId);
    if (e.Status !== EMP_STATUS.PENDING) throw appError_('บัญชีนี้ไม่ได้อยู่ในสถานะรออนุมัติ', 'VALIDATION');
    return {
      before: e,
      after: updateRecord_('Employees', e._row, {
        Status: EMP_STATUS.ACTIVE, Role: role, ActiveFrom: todayStr_(), ActiveTo: '',
        ApprovedBy: ctx.user.FullName, ApprovedAt: nowStamp_(), UpdatedAt: nowStamp_()
      })
    };
  });
  writeAudit_(ctx, 'REGISTRATION_APPROVE', 'Employee', out.after.EmployeeID, { role: role, fullName: out.after.FullName });
  return { employee: employeeView_(out.after, false), message: 'อนุมัติบัญชี ' + out.after.FullName + ' แล้ว' };
}

function rejectRegistration_(ctx, p) {
  var note = cleanLine_(p.note, 200);
  var out = withLock_(function () {
    var e = requireTargetEmployee_(p.employeeId);
    if (e.Status !== EMP_STATUS.PENDING) throw appError_('บัญชีนี้ไม่ได้อยู่ในสถานะรออนุมัติ', 'VALIDATION');
    return {
      before: e,
      after: updateRecord_('Employees', e._row, {
        Status: EMP_STATUS.REJECTED, ApprovedBy: ctx.user.FullName, ApprovedAt: nowStamp_(), UpdatedAt: nowStamp_(),
        Note: note ? 'ไม่อนุมัติ: ' + note : 'ไม่อนุมัติ'
      })
    };
  });
  writeAudit_(ctx, 'REGISTRATION_REJECT', 'Employee', out.after.EmployeeID, { fullName: out.after.FullName, note: note });
  return { employee: employeeView_(out.after, false), message: 'ปฏิเสธการสมัครของ ' + out.after.FullName + ' แล้ว' };
}

/** ลบบัญชี — อนุญาตเฉพาะบัญชีที่ไม่มีประวัติการลงเวลา/ใบลา/คำร้อง (มีประวัติให้ปิดใช้งานแทน) */
function deleteEmployee_(ctx, p) {
  var snap = withLock_(function () {
    var e = requireTargetEmployee_(p.employeeId);
    assertNotSelf_(ctx, e, 'ลบ');
    if (e.Role === ROLES.ADMIN && e.Status === EMP_STATUS.ACTIVE) assertKeepsAnAdmin_(e.EmployeeID);
    var hasHistory = findRowNumbers_('AttendanceLogs', 'EmployeeID', e.EmployeeID).length ||
      findRowNumbers_('LeaveRequests', 'EmployeeID', e.EmployeeID).length ||
      findRowNumbers_('CorrectionRequests', 'EmployeeID', e.EmployeeID).length;
    if (hasHistory) {
      throw appError_('บัญชีนี้มีประวัติการลงเวลา/การลา จึงลบไม่ได้เพื่อรักษาความโปร่งใสของข้อมูล กรุณาใช้ "ปิดใช้งาน" แทน', 'HAS_HISTORY');
    }
    deleteRowNumber_('Employees', e._row);
    return e;
  });
  writeAudit_(ctx, 'EMPLOYEE_DELETE', 'Employee', snap.EmployeeID, snapshotEmployee_(snap));
  return { deleted: true, message: 'ลบบัญชี ' + snap.FullName + ' แล้ว' };
}

/** รีเซ็ตรหัสผ่าน: สุ่มรหัสผ่านชั่วคราว + บังคับเปลี่ยน + ออกจากระบบทุกอุปกรณ์ + ปลดล็อก */
function resetEmployeePassword_(ctx, p) {
  var temp = generateTempPassword_(12);
  var hash = hashPassword_(temp);
  var e = withLock_(function () {
    var t = requireTargetEmployee_(p.employeeId);
    assertNotSelf_(ctx, t, 'รีเซ็ตรหัสผ่าน (กรุณาใช้เมนูเปลี่ยนรหัสผ่าน) ของ');
    return updateRecord_('Employees', t._row, {
      PasswordHash: hash, MustChangePassword: true,
      SessionVersion: (Number(t.SessionVersion) || 0) + 1, UpdatedAt: nowStamp_(),
      ResetRequestedAt: '', ResetRequestNote: ''
    });
  });
  clearLoginFailures_(normalizeUsername_(e.Username));
  writeAudit_(ctx, 'PASSWORD_RESET_BY_ADMIN', 'Employee', e.EmployeeID, { fullName: e.FullName });
  return {
    tempPassword: temp,
    employee: employeeView_(e, false),
    message: 'รีเซ็ตรหัสผ่านแล้ว กรุณาแจ้งรหัสผ่านชั่วคราวแก่ ' + e.FullName + ' โดยตรง ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบ'
  };
}

/** ยกเลิกคำขอรีเซ็ตรหัสผ่าน (เช่น ไม่ใช่เจ้าของบัญชีเป็นผู้ขอ) */
function dismissResetRequest_(ctx, p) {
  var e = withLock_(function () {
    var t = requireTargetEmployee_(p.employeeId);
    return updateRecord_('Employees', t._row, { ResetRequestedAt: '', ResetRequestNote: '' });
  });
  writeAudit_(ctx, 'PASSWORD_RESET_REQUEST_DISMISS', 'Employee', e.EmployeeID, { fullName: e.FullName });
  return { message: 'ยกเลิกคำขอรีเซ็ตรหัสผ่านของ ' + e.FullName + ' แล้ว' };
}

function unlockEmployee_(ctx, p) {
  var e = requireTargetEmployee_(p.employeeId);
  clearLoginFailures_(normalizeUsername_(e.Username));
  writeAudit_(ctx, 'ACCOUNT_UNLOCK', 'Employee', e.EmployeeID, null);
  return { message: 'ปลดล็อกบัญชี ' + e.FullName + ' แล้ว' };
}

/* ========================================================================== */
/*  Settings                                                                  */
/* ========================================================================== */

var SETTING_RULES_ = {
  SCHOOL_LAT: { type: 'coord', min: -90, max: 90, label: 'ละติจูด' },
  SCHOOL_LNG: { type: 'coord', min: -180, max: 180, label: 'ลองจิจูด' },
  GEOFENCE_RADIUS_M: { type: 'int', min: 10, max: 5000, label: 'รัศมีที่อนุญาต' },
  MAX_GPS_ACCURACY_M: { type: 'int', min: 5, max: 500, label: 'ค่าความแม่นยำ GPS สูงสุด' },
  CHECKOUT_REQUIRES_GPS: { type: 'bool', label: 'ลงเวลาออกงานต้องตรวจ GPS' },
  WORK_START_TIME: { type: 'time', label: 'เวลาเริ่มปฏิบัติงาน' },
  LATE_AFTER_TIME: { type: 'time', label: 'เวลาที่ถือว่ามาสาย' },
  WORK_END_TIME: { type: 'time', label: 'เวลาเลิกงาน' },
  CHECKIN_EARLIEST_TIME: { type: 'time', label: 'เวลาเปิดให้ลงเวลาเข้า' },
  WORK_DAYS: { type: 'workdays', label: 'วันทำงานประจำสัปดาห์' },
  ALLOW_HOLIDAY_CHECKIN: { type: 'bool', label: 'อนุญาตลงเวลาวันหยุด' },
  SESSION_TIMEOUT_MIN: { type: 'int', min: 5, max: 360, label: 'หมดเวลาการใช้งาน (นาที)' },
  MAX_LOGIN_ATTEMPTS: { type: 'int', min: 3, max: 20, label: 'จำนวนครั้งที่ใส่รหัสผิดได้' },
  LOCKOUT_MIN: { type: 'int', min: 1, max: 1440, label: 'ระยะเวลาล็อกบัญชี (นาที)' },
  REMEMBER_DEVICE_DAYS: { type: 'int', min: 0, max: 90, label: 'จดจำการเข้าสู่ระบบ (วัน)' },
  GPS_RETENTION_DAYS: { type: 'int', min: 30, max: 3650, label: 'ระยะเวลาเก็บพิกัด GPS (วัน)' },
  CORRECTION_MAX_DAYS: { type: 'int', min: 1, max: 365, label: 'ยื่นคำร้องย้อนหลังได้ (วัน)' },
  ALLOW_REGISTRATION: { type: 'bool', label: 'เปิดรับสมัครสมาชิก' },
  LEAVE_REQUIRES_APPROVAL: { type: 'bool', label: 'การลาที่บุคลากรบันทึกเองต้องรออนุมัติ' },
  DIRECTOR_NAME: { type: 'text', max: 80, label: 'ชื่อผู้อำนวยการ' },
  DIRECTOR_POSITION: { type: 'text', max: 100, label: 'ตำแหน่งผู้ลงนาม' },
  SCHOOL_AFFILIATION: { type: 'text', max: 100, label: 'สังกัด' },
  SETTINGS_CONFIRMED: { type: 'bool', label: 'ยืนยันการตั้งค่า' }
};

function getSettingsForAdmin_(ctx) {
  var s = getSettings_();
  var desc = {};
  DEFAULT_SETTINGS_.forEach(function (d) { desc[d[0]] = d[2]; });
  readAll_('Settings').forEach(function (r) { if (r.Key && r.Description) desc[r.Key] = r.Description; });
  var values = {};
  Object.keys(SETTING_RULES_).forEach(function (k) { values[k] = s.raw[k] === undefined ? '' : String(s.raw[k]); });
  return {
    values: values,
    descriptions: desc,
    schoolMaps: s.geofenceConfigured ? mapLinks_(s.schoolLat, s.schoolLng) : null,
    storage: driveStorageInfo_(),
    backup: backupInfo_(),
    serverTime: thaiDate_(todayStr_(), 'long') + ' ' + nowTimeStr_() + ' น.',
    timezone: APP.TZ
  };
}

function normalizeSetting_(key, value) {
  var rule = SETTING_RULES_[key];
  var v = cleanLine_(value, 100);
  switch (rule.type) {
    case 'coord':
      if (v === '') return '';
      var c = toNumber_(v);
      if (!isFinite(c) || c < rule.min || c > rule.max) throw appError_(rule.label + 'ไม่ถูกต้อง', 'VALIDATION', { field: key });
      return String(round_(c, 7));
    case 'int':
      var n = toNumber_(v);
      if (!isFinite(n) || Math.round(n) !== n || n < rule.min || n > rule.max) {
        throw appError_(rule.label + ' ต้องเป็นจำนวนเต็มระหว่าง ' + rule.min + '–' + rule.max, 'VALIDATION', { field: key });
      }
      return String(n);
    case 'time':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw appError_(rule.label + ' ต้องอยู่ในรูปแบบ ชั่วโมง:นาที', 'VALIDATION', { field: key });
      return v;
    case 'workdays':
      var days = v.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
      var uniq = [];
      days.forEach(function (d) {
        if (!/^[0-6]$/.test(d)) throw appError_('วันทำงานไม่ถูกต้อง', 'VALIDATION', { field: key });
        if (uniq.indexOf(d) < 0) uniq.push(d);
      });
      if (!uniq.length) throw appError_('กรุณาเลือกวันทำงานอย่างน้อย 1 วัน', 'VALIDATION', { field: key });
      return uniq.sort().join(',');
    case 'bool':
      return (value === true || String(value).toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
    case 'text':
      var t = cleanLine_(value, 200);
      if (t.length > rule.max) throw appError_(rule.label + 'ต้องไม่เกิน ' + rule.max + ' ตัวอักษร', 'VALIDATION', { field: key });
      return t;
    default:
      throw appError_('การตั้งค่าไม่ถูกต้อง', 'VALIDATION');
  }
}

/** ตรวจความสัมพันธ์ของค่าที่จะบันทึก (merged = ค่าทั้งหมดหลังแก้ไข) */
function validateSettingRelations_(merged) {
  if (merged.LATE_AFTER_TIME < merged.WORK_START_TIME) throw appError_('เวลาที่ถือว่ามาสายต้องไม่ก่อนเวลาเริ่มปฏิบัติงาน', 'VALIDATION', { field: 'LATE_AFTER_TIME' });
  if (merged.WORK_END_TIME <= merged.LATE_AFTER_TIME) throw appError_('เวลาเลิกงานต้องหลังเวลาที่ถือว่ามาสาย', 'VALIDATION', { field: 'WORK_END_TIME' });
  if (merged.CHECKIN_EARLIEST_TIME > merged.WORK_START_TIME) throw appError_('เวลาเปิดให้ลงเวลาเข้าต้องไม่หลังเวลาเริ่มปฏิบัติงาน', 'VALIDATION', { field: 'CHECKIN_EARLIEST_TIME' });
  if ((merged.SCHOOL_LAT === '') !== (merged.SCHOOL_LNG === '')) throw appError_('กรุณากรอกทั้งละติจูดและลองจิจูด', 'VALIDATION', { field: 'SCHOOL_LAT' });
  if (merged.SETTINGS_CONFIRMED === 'TRUE' && merged.SCHOOL_LAT === '') {
    throw appError_('กรุณาตั้งค่าพิกัดโรงเรียนก่อนยืนยันการตั้งค่า', 'VALIDATION', { field: 'SCHOOL_LAT' });
  }
}

/** เขียนค่าที่เปลี่ยนลงชีต Settings (เรียกภายใต้ Lock) → รายการที่เปลี่ยน */
function writeSettingValues_(next, current, actorName) {
  var changes = [];
  var byKey = {};
  readAll_('Settings').forEach(function (r) { byKey[r.Key] = r; });
  Object.keys(next).forEach(function (k) {
    var before = String(current[k] === undefined ? '' : current[k]);
    if (before === next[k]) return;
    changes.push({ key: k, label: SETTING_RULES_[k].label, from: before, to: next[k] });
    if (byKey[k]) {
      updateRecord_('Settings', byKey[k]._row, { Value: next[k], UpdatedAt: nowStamp_(), UpdatedBy: actorName });
    } else {
      var desc = '';
      DEFAULT_SETTINGS_.forEach(function (d) { if (d[0] === k) desc = d[2]; });
      appendRecord_('Settings', { Key: k, Value: next[k], Description: desc, UpdatedAt: nowStamp_(), UpdatedBy: actorName });
    }
  });
  return changes;
}

function saveSettings_(ctx, p) {
  var input = p.values || {};
  var current = getSettings_().raw;
  var next = {};
  Object.keys(input).forEach(function (k) {
    if (!SETTING_RULES_[k]) return;
    next[k] = normalizeSetting_(k, input[k]);
  });
  var merged = {};
  Object.keys(SETTING_RULES_).forEach(function (k) { merged[k] = k in next ? next[k] : String(current[k] === undefined ? '' : current[k]); });
  validateSettingRelations_(merged);
  var changes = withLock_(function () { return writeSettingValues_(next, current, ctx.user.FullName); });
  if (changes.length) writeAudit_(ctx, 'SETTINGS_UPDATE', 'Settings', '', { changes: changes });
  resetMemo_();
  return { changes: changes.length, message: changes.length ? 'บันทึกการตั้งค่าแล้ว (' + changes.length + ' รายการ)' : 'ไม่มีการเปลี่ยนแปลง' };
}

/* ========================================================================== */
/*  Work calendar                                                             */
/* ========================================================================== */

/** วันหยุดราชการที่มีวันที่คงที่ทุกปี */
var FIXED_HOLIDAYS_ = [
  ['01-01', 'วันขึ้นปีใหม่'],
  ['04-06', 'วันจักรี'],
  ['04-13', 'วันสงกรานต์'],
  ['04-14', 'วันสงกรานต์'],
  ['04-15', 'วันสงกรานต์'],
  ['05-04', 'วันฉัตรมงคล'],
  ['06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
  ['07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
  ['08-12', 'วันแม่แห่งชาติ'],
  ['10-13', 'วันนวมินทรมหาราช'],
  ['10-23', 'วันปิยมหาราช'],
  ['12-05', 'วันชาติ และวันพ่อแห่งชาติ'],
  ['12-10', 'วันรัฐธรรมนูญ'],
  ['12-31', 'วันสิ้นปี']
];

/**
 * วันหยุดราชการไทยรายปีที่ครบทุกวัน (รวมวันหยุดทางพุทธศาสนา วันหยุดพิเศษ และวันหยุดชดเชย)
 * วันหยุดทางพุทธศาสนาเปลี่ยนตามปฏิทินจันทรคติทุกปี จึงบันทึกเป็นรายปีจากประกาศ/ปฏิทินวันหยุดราชการที่เผยแพร่
 * ปีที่ไม่มีในรายการ ระบบใช้วันที่คงที่ + คำนวณวันหยุดชดเชยอัตโนมัติ และให้ผู้ดูแลเพิ่มวันหยุดทางพุทธศาสนาเอง
 */
var THAI_HOLIDAY_DATA_ = {
  2026: {
    note: 'วันหยุดราชการ พ.ศ. 2569 ตามปฏิทินวันหยุดราชการที่เผยแพร่ (รวมวันหยุดพิเศษ 2 ม.ค. ตามมติ ครม.)',
    days: [
      ['01-01', 'วันขึ้นปีใหม่'], ['01-02', 'วันหยุดพิเศษ (ต่อเนื่องวันขึ้นปีใหม่)'], ['03-03', 'วันมาฆบูชา'],
      ['04-06', 'วันจักรี'], ['04-13', 'วันสงกรานต์'], ['04-14', 'วันสงกรานต์'], ['04-15', 'วันสงกรานต์'],
      ['05-04', 'วันฉัตรมงคล'], ['05-31', 'วันวิสาขบูชา'], ['06-01', 'วันหยุดชดเชยวันวิสาขบูชา'],
      ['06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
      ['07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'], ['07-29', 'วันอาสาฬหบูชา'], ['07-30', 'วันเข้าพรรษา'],
      ['08-12', 'วันแม่แห่งชาติ'], ['10-13', 'วันนวมินทรมหาราช'], ['10-23', 'วันปิยมหาราช'],
      ['12-05', 'วันชาติ และวันพ่อแห่งชาติ'], ['12-07', 'วันหยุดชดเชยวันชาติและวันพ่อแห่งชาติ'],
      ['12-10', 'วันรัฐธรรมนูญ'], ['12-31', 'วันสิ้นปี']
    ]
  },
  2027: {
    note: 'วันหยุดราชการ พ.ศ. 2570 (ร่าง) ตามปฏิทินวันหยุดที่เผยแพร่ — ยังรอมติ ครม. กรุณาตรวจสอบอีกครั้งเมื่อประกาศ',
    days: [
      ['01-01', 'วันขึ้นปีใหม่'], ['02-21', 'วันมาฆบูชา'], ['02-22', 'วันหยุดชดเชยวันมาฆบูชา'],
      ['04-06', 'วันจักรี'], ['04-13', 'วันสงกรานต์'], ['04-14', 'วันสงกรานต์'], ['04-15', 'วันสงกรานต์'],
      ['05-04', 'วันฉัตรมงคล'], ['05-20', 'วันวิสาขบูชา'], ['06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
      ['07-18', 'วันอาสาฬหบูชา'], ['07-19', 'วันเข้าพรรษา'], ['07-20', 'วันหยุดชดเชยวันอาสาฬหบูชา'],
      ['07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'], ['08-12', 'วันแม่แห่งชาติ'],
      ['10-13', 'วันนวมินทรมหาราช'], ['10-23', 'วันปิยมหาราช'], ['10-25', 'วันหยุดชดเชยวันปิยมหาราช'],
      ['12-05', 'วันชาติ และวันพ่อแห่งชาติ'], ['12-06', 'วันหยุดชดเชยวันชาติและวันพ่อแห่งชาติ'],
      ['12-10', 'วันรัฐธรรมนูญ'], ['12-31', 'วันสิ้นปี']
    ]
  }
};

/** รายการวันหยุดราชการไทยของปี y → {complete, note, days: [{date, title}]} */
function thaiHolidaysForYear_(y) {
  var data = THAI_HOLIDAY_DATA_[y];
  if (data) {
    return { complete: true, note: data.note, days: data.days.map(function (d) { return { date: y + '-' + d[0], title: d[1] }; }) };
  }
  var days = FIXED_HOLIDAYS_.map(function (h) { return { date: y + '-' + h[0], title: h[1] }; });
  var taken = {};
  days.forEach(function (h) { taken[h.date] = true; });
  var subs = [];
  days.forEach(function (h) {
    var dow = dayOfWeek_(h.date);
    if (dow !== 0 && dow !== 6) return;
    // ตรงกับวันเสาร์/อาทิตย์ → หยุดชดเชยวันทำการถัดไปที่ยังไม่เป็นวันหยุด
    var d = h.date;
    do { d = addDays_(d, 1); } while (dayOfWeek_(d) === 0 || dayOfWeek_(d) === 6 || taken[d]);
    taken[d] = true;
    subs.push({ date: d, title: 'วันหยุดชดเชย' + h.title });
  });
  return {
    complete: false,
    note: 'ปี พ.ศ. ' + (y + 543) + ': เพิ่มวันหยุดที่มีวันที่คงที่และวันหยุดชดเชยที่คำนวณอัตโนมัติ — วันหยุดทางพุทธศาสนา (มาฆบูชา วิสาขบูชา อาสาฬหบูชา เข้าพรรษา) และวันหยุดพิเศษตามมติ ครม. กรุณาเพิ่มเองตามประกาศ',
    days: days.concat(subs).sort(function (a, b) { return a.date < b.date ? -1 : 1; })
  };
}

/**
 * เพิ่มวันหยุดราชการไทยลงปฏิทินอัตโนมัติ (เรียกตอนติดตั้ง/อัปเดตเวอร์ชัน/งานรายคืน ภายใต้ Lock)
 * จดจำวันที่เคยเพิ่มให้แล้วใน Script Properties → ถ้าผู้ดูแลลบวันใดออก ระบบจะไม่เพิ่มกลับมาเอง
 */
function seedThaiHolidays_(years) {
  var props = PropertiesService.getScriptProperties();
  var existing = {};
  readAll_('WorkCalendar').forEach(function (r) { existing[r.Date] = true; });
  var add = [];
  years.forEach(function (y) {
    var key = 'HOLIDAYS_OFFERED_' + y;
    var offered = [];
    try { offered = JSON.parse(props.getProperty(key) || '[]'); } catch (e) { offered = []; }
    var changed = false;
    thaiHolidaysForYear_(y).days.forEach(function (h) {
      if (offered.indexOf(h.date) >= 0) return;
      offered.push(h.date); changed = true;
      if (existing[h.date]) return;
      existing[h.date] = true;
      add.push({ Date: h.date, Type: 'OFFICIAL_HOLIDAY', Title: h.title, CreatedBy: 'ระบบ (วันหยุดราชการไทย)', CreatedAt: nowStamp_() });
    });
    if (changed) props.setProperty(key, JSON.stringify(offered));
  });
  if (add.length) appendRecords_('WorkCalendar', add);
  return add.length;
}

/** 'yyyy-MM-dd' → '1 ม.ค. 2569 (พฤ.)' */
function calendarDateLabel_(ymd) {
  var p = parseYmd_(ymd);
  if (!p) return String(ymd || '');
  return p.d + ' ' + THAI_MONTHS_SHORT[p.m - 1] + ' ' + (p.y + 543) + ' (' + THAI_DAYS_SHORT[dayOfWeek_(ymd)] + ')';
}

function calendarView_(r) {
  return {
    date: r.Date, dateLabel: calendarDateLabel_(r.Date), type: r.Type, typeLabel: CALENDAR_TYPES[r.Type] || r.Type,
    title: r.Title, createdBy: r.CreatedBy, weekend: dayOfWeek_(r.Date) === 0 || dayOfWeek_(r.Date) === 6
  };
}

function listCalendar_(ctx, p) {
  var y = parseInt(p.year, 10);
  if (!isFinite(y) || y < 2000 || y > 2200) y = +todayStr_().substr(0, 4);
  var s = getSettings_();
  var info = thaiHolidaysForYear_(y);
  var entries = readAll_('WorkCalendar').filter(function (r) { return String(r.Date).substr(0, 4) === String(y); })
    .sort(function (a, b) { return a.Date < b.Date ? -1 : 1; }).map(calendarView_);
  return {
    year: y, entries: entries,
    workDays: s.workDays, workDayNames: s.workDays.map(function (d) { return THAI_DAYS[d]; }),
    holidayDataComplete: info.complete, holidayNote: info.note,
    canEdit: ctx.user.Role === ROLES.ADMIN
  };
}

function addCalendarEntries_(ctx, p) {
  var start = String(p.startDate || ''), end = String(p.endDate || p.startDate || '');
  if (!isValidYmd_(start) || !isValidYmd_(end)) throw appError_('กรุณาเลือกวันที่ให้ถูกต้อง', 'VALIDATION');
  if (end < start) throw appError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น', 'VALIDATION');
  if (daysBetween_(start, end) > 120) throw appError_('เพิ่มได้ครั้งละไม่เกิน 120 วัน', 'VALIDATION');
  var type = String(p.type || '');
  if (!CALENDAR_TYPES[type]) throw appError_('กรุณาเลือกประเภทวัน', 'VALIDATION');
  var title = cleanLine_(p.title, 150);
  if (title.length < 2) throw appError_('กรุณาระบุชื่อวันหยุด/รายละเอียด', 'VALIDATION');
  var dates = dateList_(start, end);
  var res = withLock_(function () {
    var rows = readAll_('WorkCalendar');
    var byDate = {};
    rows.forEach(function (r) { byDate[r.Date] = r; });
    var added = [], updated = 0, kept = 0;
    dates.forEach(function (d) {
      // เพิ่มเป็นช่วง (เช่น ปิดภาคเรียน) ไม่ทับวันหยุดราชการเดิมในช่วงนั้น — แก้ไขรายวันได้โดยเลือกวันเดียว
      if (byDate[d] && start !== end && byDate[d].Type === 'OFFICIAL_HOLIDAY' && type !== 'SPECIAL_WORKDAY') { kept++; return; }
      if (byDate[d]) {
        updateRecord_('WorkCalendar', byDate[d]._row, { Type: type, Title: title, CreatedBy: ctx.user.FullName, CreatedAt: nowStamp_() });
        updated++;
      } else {
        added.push({ Date: d, Type: type, Title: title, CreatedBy: ctx.user.FullName, CreatedAt: nowStamp_() });
      }
    });
    appendRecords_('WorkCalendar', added);
    return { added: added.length, updated: updated, kept: kept };
  });
  writeAudit_(ctx, 'CALENDAR_ADD', 'WorkCalendar', start + (end !== start ? '..' + end : ''), { type: type, title: title, added: res.added, updated: res.updated, kept: res.kept });
  return {
    added: res.added, updated: res.updated, kept: res.kept,
    message: 'บันทึกปฏิทินแล้ว (เพิ่ม ' + res.added + ' วัน, ปรับปรุง ' + res.updated + ' วัน' + (res.kept ? ', คงวันหยุดราชการเดิม ' + res.kept + ' วัน' : '') + ')'
  };
}

function removeCalendarEntry_(ctx, p) {
  var date = String(p.date || '');
  if (!isValidYmd_(date)) throw appError_('วันที่ไม่ถูกต้อง', 'VALIDATION');
  var removed = withLock_(function () {
    var r = findOne_('WorkCalendar', 'Date', date);
    if (!r) throw appError_('ไม่พบรายการ', 'NOT_FOUND');
    deleteRowNumber_('WorkCalendar', r._row);
    return r;
  });
  writeAudit_(ctx, 'CALENDAR_REMOVE', 'WorkCalendar', date, { type: removed.Type, title: removed.Title });
  return { message: 'ลบรายการวันที่ ' + thaiDate_(date) + ' แล้ว' };
}

/** ปุ่ม "เพิ่มวันหยุดราชการไทย" ของปีที่เลือก (เพิ่มเฉพาะวันที่ยังไม่มีในปฏิทิน) */
function addFixedHolidays_(ctx, p) {
  var y = parseInt(p.year, 10);
  if (!isFinite(y) || y < 2000 || y > 2200) throw appError_('ปีไม่ถูกต้อง', 'VALIDATION');
  var info = thaiHolidaysForYear_(y);
  var res = withLock_(function () {
    var existing = {};
    readAll_('WorkCalendar').forEach(function (r) { existing[r.Date] = true; });
    var add = [];
    info.days.forEach(function (h) {
      if (!existing[h.date]) add.push({ Date: h.date, Type: 'OFFICIAL_HOLIDAY', Title: h.title, CreatedBy: ctx.user.FullName, CreatedAt: nowStamp_() });
    });
    appendRecords_('WorkCalendar', add);
    var key = 'HOLIDAYS_OFFERED_' + y;
    var offered = [];
    try { offered = JSON.parse(PropertiesService.getScriptProperties().getProperty(key) || '[]'); } catch (e) { offered = []; }
    info.days.forEach(function (h) { if (offered.indexOf(h.date) < 0) offered.push(h.date); });
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(offered));
    return add.length;
  });
  writeAudit_(ctx, 'CALENDAR_ADD_FIXED', 'WorkCalendar', String(y), { added: res, complete: info.complete });
  return {
    added: res, complete: info.complete,
    message: 'เพิ่มวันหยุดราชการไทยปี พ.ศ. ' + (y + 543) + ' จำนวน ' + res + ' วัน' +
      (res ? '' : ' (มีครบแล้ว)') + ' — ' + info.note
  };
}

/* ========================================================================== */
/*  Audit log                                                                 */
/* ========================================================================== */

function listAuditLogs_(ctx, p) {
  var q = cleanLine_(p.q, 60).toLowerCase();
  var action = cleanLine_(p.action, 40);
  var limit = Math.min(500, Math.max(20, parseInt(p.limit, 10) || 200));
  var rows = readTail_('AuditLogs', 3000).reverse();
  var out = [];
  for (var i = 0; i < rows.length && out.length < limit; i++) {
    var r = rows[i];
    if (action && r.Action !== action) continue;
    if (q && (r.ActorName + ' ' + r.Action + ' ' + r.TargetID + ' ' + r.Details).toLowerCase().indexOf(q) < 0) continue;
    out.push({
      logId: r.LogID, time: thaiStamp_(r.Timestamp), timestamp: r.Timestamp, actor: r.ActorName, role: r.ActorRole,
      action: r.Action, targetType: r.TargetType, targetId: r.TargetID, details: r.Details
    });
  }
  return out;
}

/* ========================================================================== */
/*  Maintenance: สร้าง DailySummary ใหม่จาก AttendanceLogs                     */
/* ========================================================================== */

/**
 * คำนวณตารางสรุปรายวันของเดือนที่เลือกใหม่ จากรายการลงเวลาที่ยังใช้งาน (IsActive)
 * ใช้เมื่อมีการแก้ไขข้อมูลในชีตโดยตรง หรือเปลี่ยนเวลาทำงาน/ปฏิทินย้อนหลัง
 * (AttendanceLogs ไม่ถูกแก้ไข — DailySummary เป็นข้อมูลที่คำนวณได้ใหม่เสมอ)
 */
function rebuildDailySummary_(ctx, p) {
  var ym = parseYearMonth_(p);
  var from = monthStart_(ym.y, ym.m), to = monthEnd_(ym.y, ym.m);
  var s = getSettings_(), cal = getCalendarMap_();
  var count = withLock_(function () {
    var groups = {};
    readAll_('AttendanceLogs').forEach(function (g) {
      if (!g.IsActive || g.Date < from || g.Date > to) return;
      var k = summaryKey_(g.Date, g.EmployeeID);
      var grp = groups[k] || (groups[k] = { date: g.Date, empId: g.EmployeeID, staffCode: g.StaffCode, fullName: g.FullName, IN: null, OUT: null, corrected: false });
      var cur = grp[g.Type];
      if (!cur || g.Timestamp > cur.Timestamp) grp[g.Type] = g;
      if (g.Source === 'CORRECTION') grp.corrected = true;
    });
    var recs = Object.keys(groups).map(function (k) {
      var grp = groups[k];
      var info = getDayInfo_(grp.date, s, cal);
      var rec = {
        Key: k, Date: grp.date, EmployeeID: grp.empId, StaffCode: grp.staffCode, FullName: grp.fullName,
        CheckInTime: grp.IN ? grp.IN.Time : '', CheckOutTime: grp.OUT ? grp.OUT.Time : '',
        CheckInLogID: grp.IN ? grp.IN.AttendanceID : '', CheckOutLogID: grp.OUT ? grp.OUT.AttendanceID : '',
        InDistanceM: grp.IN ? grp.IN.DistanceM : null, OutDistanceM: grp.OUT ? grp.OUT.DistanceM : null,
        IsLate: false, LateMinutes: 0, EarlyLeave: false, WorkMinutes: null,
        DayType: info.isWorkday ? 'WORKDAY' : 'HOLIDAY', Corrected: grp.corrected, UpdatedAt: nowStamp_()
      };
      if (grp.IN) { var a = computeLogStatus_('IN', grp.IN.Time, info, s); rec.IsLate = a.isLate; rec.LateMinutes = a.lateMinutes; }
      if (grp.OUT) rec.EarlyLeave = computeLogStatus_('OUT', grp.OUT.Time, info, s).early;
      if (rec.CheckInTime && rec.CheckOutTime) rec.WorkMinutes = Math.max(0, Math.round(timeToMin_(rec.CheckOutTime) - timeToMin_(rec.CheckInTime)));
      return rec;
    });
    var keep = readAll_('DailySummary').filter(function (r) { return r.Date < from || r.Date > to; });
    var t = getTable_('DailySummary');
    var all = keep.map(function (r) { var c = {}; for (var x in r) if (x !== '_row') c[x] = r[x]; return c; }).concat(recs)
      .sort(function (a, b) { return a.Date === b.Date ? (a.StaffCode < b.StaffCode ? -1 : 1) : (a.Date < b.Date ? -1 : 1); });
    var last = t.sheet.getLastRow();
    if (last >= 2) t.sheet.getRange(2, 1, last - 1, t.width).clearContent();
    if (all.length) {
      ensureRows_(t.sheet, all.length + 1);
      t.sheet.getRange(2, 1, all.length, t.width).setValues(all.map(function (r) { return recordToRow_(t, r, null); }));
    }
    markDirty_('DailySummary');
    return recs.length;
  });
  writeAudit_(ctx, 'SUMMARY_REBUILD', 'DailySummary', from.substr(0, 7), { rows: count });
  return { message: 'คำนวณสรุปรายวันเดือน' + thaiMonthYear_(ym.y, ym.m) + ' ใหม่แล้ว (' + count + ' รายการ)' };
}

/* ======================================================================
 * Reports.gs
 * ====================================================================== */
/**
 * ============================================================================
 *  Reports.gs — คำนวณสถานะการปฏิบัติงาน, รายงานรายวัน/รายเดือน/รายปี/รายบุคคล
 *               และส่งออก Excel (.xlsx) / PDF ผ่าน Google Drive (ไฟล์ชั่วคราว)
 * ============================================================================
 *  นิยามสถานะรายวัน (อ้างอิงการตั้งค่าเวลา + ปฏิทินวันหยุด + ใบลาที่อนุมัติ):
 *   PRESENT      มาปฏิบัติงาน (ลงเวลาเข้าไม่เกินเวลาที่ถือว่าสาย)
 *   LATE         มาสาย (ลงเวลาเข้าหลัง LATE_AFTER_TIME; ลาครึ่งเช้าไม่นับสาย)
 *   LEAVE        ลา (มีใบลาที่อนุมัติ และไม่มีการลงเวลา)
 *   ABSENT       ขาดงาน (วันทำงาน ไม่มีการลงเวลา ไม่มีใบลา และพ้นเวลาเลิกงานแล้ว)
 *   NOT_YET      ยังไม่ลงเวลา (วันนี้ ยังไม่ถึงเวลาเลิกงาน)
 *   HOLIDAY      วันหยุด
 *   HOLIDAY_WORK ปฏิบัติงานในวันหยุด
 *  ธงเพิ่มเติม: missingIn (ไม่ลงเวลาเข้า), missingOut (ไม่ลงเวลาออก), earlyLeave (ออกก่อนเวลา)
 * ============================================================================
 */

/* ========================================================================== */
/*  Core computation                                                          */
/* ========================================================================== */

/**
 * คำนวณสถานะรายวันของบุคลากร
 * @param {{employees: Object[], from: string, to: string, withLogs?: boolean}} opts
 */
function computeAttendance_(opts) {
  var s = getSettings_();
  var cal = getCalendarMap_();
  var today = todayStr_();
  var nowMin = timeToMin_(nowTimeStr_());
  var from = opts.from;
  var to = opts.to < today ? opts.to : today; // ไม่คำนวณวันในอนาคต
  var dates = from <= to ? dateList_(from, to) : [];
  var infos = {};
  dates.forEach(function (d) { infos[d] = getDayInfo_(d, s, cal); });
  var ids = {};
  opts.employees.forEach(function (e) { ids[e.EmployeeID] = true; });

  var sums = {};
  if (dates.length) {
    readAll_('DailySummary').forEach(function (r) {
      if (r.Date >= from && r.Date <= to && ids[r.EmployeeID]) sums[r.Key] = r;
    });
  }
  var leaves = {};
  if (dates.length) {
    readAll_('LeaveRequests').forEach(function (l) {
      if (l.Status !== REQUEST_STATUS.APPROVED || !ids[l.EmployeeID]) return;
      if (l.EndDate < from || l.StartDate > to) return;
      var a = l.StartDate > from ? l.StartDate : from;
      var b = l.EndDate < to ? l.EndDate : to;
      dateList_(a, b).forEach(function (d) { leaves[d + '|' + l.EmployeeID] = l; });
    });
  }
  var logs = {};
  if (opts.withLogs && dates.length) {
    readAll_('AttendanceLogs').forEach(function (g) {
      if (g.IsActive && g.Date >= from && g.Date <= to && ids[g.EmployeeID]) logs[g.AttendanceID] = g;
    });
  }
  var todayEnded = nowMin >= timeToMin_(s.workEnd);

  var people = opts.employees.map(function (emp) {
    var days = [];
    dates.forEach(function (date) {
      if (emp.ActiveFrom && date < emp.ActiveFrom) return;
      if (emp.ActiveTo && date > emp.ActiveTo) return;
      var key = date + '|' + emp.EmployeeID;
      var d = buildDay_(date, infos[date], sums[key] || null, leaves[key] || null, date < today || todayEnded);
      if (opts.withLogs && sums[key]) {
        var gi = logs[sums[key].CheckInLogID], go = logs[sums[key].CheckOutLogID];
        d.inMaps = gi ? mapLinks_(gi.Latitude, gi.Longitude) : null;
        d.outMaps = go ? mapLinks_(go.Latitude, go.Longitude) : null;
        d.inAccuracy = gi ? gi.Accuracy : null;
        d.outAccuracy = go ? go.Accuracy : null;
      }
      days.push(d);
    });
    return { emp: basicEmployee_(emp), days: days, totals: totalsOf_(days) };
  });
  return { from: from, to: to, today: today, dates: dates, infos: infos, people: people, settings: s };
}

function basicEmployee_(e) {
  return {
    employeeId: e.EmployeeID, staffCode: e.StaffCode, fullName: e.FullName, position: e.Position,
    role: e.Role, status: e.Status, activeFrom: e.ActiveFrom, activeTo: e.ActiveTo
  };
}

function buildDay_(date, info, sum, leave, ended) {
  var d = {
    date: date,
    dateShort: thaiDate_(date, 'short'),
    dayName: info.dayName,
    isWorkday: info.isWorkday,
    holidayName: info.holidayName,
    checkIn: sum && sum.CheckInTime ? sum.CheckInTime : '',
    checkOut: sum && sum.CheckOutTime ? sum.CheckOutTime : '',
    inDistanceM: sum ? sum.InDistanceM : null,
    outDistanceM: sum ? sum.OutDistanceM : null,
    workMinutes: sum ? sum.WorkMinutes : null,
    corrected: sum ? !!sum.Corrected : false,
    isLate: false, lateMinutes: 0, earlyLeave: false,
    missingIn: false, missingOut: false, inProgress: false,
    leave: leave ? {
      id: leave.LeaveID, type: leave.LeaveType, typeLabel: leaveTypeLabel_(leave),
      period: leave.Period || 'FULL', periodLabel: LEAVE_PERIODS[leave.Period || 'FULL']
    } : null
  };
  var halfMorning = leave && leave.Period === 'MORNING';
  var halfAfternoon = leave && leave.Period === 'AFTERNOON';
  if (!info.isWorkday) {
    d.status = (d.checkIn || d.checkOut) ? 'HOLIDAY_WORK' : 'HOLIDAY';
  } else if (d.checkIn || d.checkOut) {
    d.isLate = !!sum.IsLate && !halfMorning;
    d.lateMinutes = d.isLate ? (Number(sum.LateMinutes) || 0) : 0;
    d.earlyLeave = !!sum.EarlyLeave && !halfAfternoon;
    d.status = d.isLate ? 'LATE' : 'PRESENT';
    if (!d.checkIn) d.missingIn = true;
    if (!d.checkOut) {
      if (!ended) d.inProgress = true;
      else if (!halfAfternoon) d.missingOut = true;
    }
  } else if (leave) {
    d.status = 'LEAVE';
  } else if (ended) {
    d.status = 'ABSENT';
  } else {
    d.status = 'NOT_YET';
  }
  d.statusLabel = DAY_STATUS_LABELS[d.status];
  var notes = [];
  if (d.leave) notes.push(d.leave.typeLabel + (d.leave.period !== 'FULL' ? ' (' + d.leave.periodLabel + ')' : ''));
  if (d.missingIn) notes.push('ไม่ลงเวลาเข้า');
  if (d.missingOut) notes.push('ไม่ลงเวลาออก');
  if (d.inProgress) notes.push('ยังไม่ลงเวลาออก');
  if (d.earlyLeave) notes.push('ออกก่อนเวลา');
  if (d.corrected) notes.push('แก้ไขเวลาตามคำร้อง');
  if (!info.isWorkday && info.holidayName) notes.push(info.holidayName);
  d.note = notes.join(', ');
  return d;
}

function totalsOf_(days) {
  var t = {
    workdays: 0, present: 0, late: 0, lateMinutes: 0, leaveDays: 0, absent: 0, incomplete: 0,
    missingIn: 0, missingOut: 0, earlyLeave: 0, holidayWork: 0, notYet: 0,
    avgIn: '', avgOut: '', rate: null
  };
  var inSum = 0, inN = 0, outSum = 0, outN = 0;
  days.forEach(function (d) {
    if (d.status === 'HOLIDAY') return;
    if (d.status === 'HOLIDAY_WORK') { t.holidayWork++; return; }
    if (d.status === 'NOT_YET') { t.notYet++; return; }
    t.workdays++;
    if (d.status === 'PRESENT' || d.status === 'LATE') t.present++;
    if (d.status === 'LATE') { t.late++; t.lateMinutes += d.lateMinutes; }
    if (d.leave) t.leaveDays += d.leave.period === 'FULL' ? 1 : 0.5;
    if (d.status === 'ABSENT') t.absent++;
    if (d.missingIn) t.missingIn++;
    if (d.missingOut) t.missingOut++;
    if (d.missingIn || d.missingOut) t.incomplete++;
    if (d.earlyLeave) t.earlyLeave++;
    if (d.checkIn) { inSum += timeToMin_(d.checkIn); inN++; }
    if (d.checkOut) { outSum += timeToMin_(d.checkOut); outN++; }
  });
  t.avgIn = inN ? minToHHMM_(inSum / inN) : '';
  t.avgOut = outN ? minToHHMM_(outSum / outN) : '';
  var denom = t.workdays - t.leaveDays;
  t.rate = denom > 0 ? round_(Math.min(100, t.present / denom * 100), 1) : null;
  return t;
}

/** บุคลากรที่ต้องแสดงในรายงานช่วงวันที่ (รวมผู้ที่ปิดใช้งานภายหลังแต่ยังอยู่ในช่วงนั้น) */
function reportEmployees_(from, to) {
  return getEmployees_().filter(function (e) {
    if (e.Status !== EMP_STATUS.ACTIVE && e.Status !== EMP_STATUS.INACTIVE) return false;
    if (!e.ActiveFrom || e.ActiveFrom > to) return false;
    if (e.Status === EMP_STATUS.INACTIVE && (!e.ActiveTo || e.ActiveTo < from)) return false;
    return true;
  }).sort(function (a, b) { return String(a.StaffCode).localeCompare(String(b.StaffCode), 'th', { numeric: true }); });
}

function validateDateParam_(v, label) {
  if (!isValidYmd_(v)) throw appError_('กรุณาเลือก' + (label || 'วันที่') + 'ให้ถูกต้อง', 'VALIDATION');
  return v;
}

/* ========================================================================== */
/*  Report builders                                                           */
/* ========================================================================== */

function reportHeader_(ctx, type, title, periodLabel, orientation) {
  var s = getSettings_();
  return {
    signer: { name: s.directorName, position: s.directorPosition },
    type: type,
    school: APP.SCHOOL_FULL,
    title: title,
    periodLabel: periodLabel,
    generatedAt: thaiDate_(todayStr_()) + ' เวลา ' + nowTimeStr_().substr(0, 5) + ' น.',
    generatedBy: ctx.user.FullName,
    orientation: orientation || 'landscape',
    tables: [],
    summary: []
  };
}

/** รายงานรายวัน */
function reportDaily_(ctx, p) {
  var date = validateDateParam_(p.date || todayStr_());
  if (date > todayStr_()) throw appError_('ไม่สามารถดูรายงานของวันที่ในอนาคตได้', 'VALIDATION');
  var emps = reportEmployees_(date, date);
  var res = computeAttendance_({ employees: emps, from: date, to: date, withLogs: true });
  var info = res.infos[date];
  var rep = reportHeader_(ctx, 'daily', 'รายงานการลงเวลาปฏิบัติงานประจำวัน', thaiDate_(date, 'long'));
  var c = { total: 0, present: 0, onTime: 0, late: 0, leave: 0, absent: 0, missingIn: 0, missingOut: 0, notYet: 0, holidayWork: 0, earlyLeave: 0 };
  var rows = [];
  res.people.forEach(function (pp) {
    if (!pp.days.length) return;
    var d = pp.days[0];
    c.total++;
    if (d.status === 'PRESENT' || d.status === 'LATE') c.present++;
    if (d.status === 'PRESENT') c.onTime++;
    if (d.status === 'LATE') c.late++;
    if (d.leave) c.leave++;
    if (d.status === 'ABSENT') c.absent++;
    if (d.missingIn) c.missingIn++;
    if (d.missingOut) c.missingOut++;
    if (d.status === 'NOT_YET') c.notYet++;
    if (d.status === 'HOLIDAY_WORK') c.holidayWork++;
    if (d.earlyLeave) c.earlyLeave++;
    rows.push({
      no: rows.length + 1, staffCode: pp.emp.staffCode, fullName: pp.emp.fullName, position: pp.emp.position,
      checkIn: d.checkIn ? d.checkIn.substr(0, 5) : '-', checkOut: d.checkOut ? d.checkOut.substr(0, 5) : '-',
      status: d.statusLabel, statusCode: d.status, lateMinutes: d.lateMinutes || '',
      inDistance: d.inDistanceM !== null && d.inDistanceM !== undefined ? d.inDistanceM : '',
      outDistance: d.outDistanceM !== null && d.outDistanceM !== undefined ? d.outDistanceM : '',
      note: d.note, inMaps: d.inMaps || null, outMaps: d.outMaps || null, employeeId: pp.emp.employeeId,
      leaveType: d.leave ? d.leave.type : '', leaveLabel: d.leave ? d.leave.typeLabel + (d.leave.period !== 'FULL' ? ' (' + d.leave.periodLabel + ')' : '') : ''
    });
  });
  rep.dayInfo = { isWorkday: info ? info.isWorkday : true, holidayName: info ? info.holidayName : '' };
  var dp = parseYmd_(date), s = res.settings;
  rep.signBook = {
    dayName: THAI_DAYS[dayOfWeek_(date)], day: dp.d, month: THAI_MONTHS[dp.m - 1], year: dp.y + 543,
    workStart: s.workStart, lateAfter: s.lateAfter, workEnd: s.workEnd
  };
  rep.tables.push({
    key: 'main',
    title: info && !info.isWorkday ? 'หมายเหตุ: วันนี้เป็น' + info.holidayName : '',
    columns: [
      { key: 'no', label: 'ที่', align: 'center', width: 40 },
      { key: 'staffCode', label: 'รหัส', align: 'center', width: 80 },
      { key: 'fullName', label: 'ชื่อ-นามสกุล', width: 200 },
      { key: 'position', label: 'ตำแหน่ง', width: 140 },
      { key: 'checkIn', label: 'เวลาเข้า', align: 'center', width: 70 },
      { key: 'checkOut', label: 'เวลาออก', align: 'center', width: 70 },
      { key: 'status', label: 'สถานะ', align: 'center', width: 110 },
      { key: 'lateMinutes', label: 'สาย (นาที)', align: 'center', width: 70 },
      { key: 'inDistance', label: 'ระยะเข้า (ม.)', align: 'center', width: 80 },
      { key: 'note', label: 'หมายเหตุ', width: 200 }
    ],
    rows: rows
  });
  rep.summary = [
    { label: 'บุคลากรทั้งหมด', value: c.total, unit: 'คน', tone: 'navy' },
    { label: 'มาปฏิบัติงาน', value: c.present, unit: 'คน', tone: 'success' },
    { label: 'มาสาย', value: c.late, unit: 'คน', tone: 'warning' },
    { label: 'ลา', value: c.leave, unit: 'คน', tone: 'sky' },
    { label: 'ขาดงาน', value: c.absent, unit: 'คน', tone: 'danger' },
    { label: 'ไม่ลงเวลาเข้า', value: c.missingIn, unit: 'คน', tone: 'danger' },
    { label: 'ไม่ลงเวลาออก', value: c.missingOut, unit: 'คน', tone: 'warning' },
    { label: 'ยังไม่ลงเวลา', value: c.notYet, unit: 'คน', tone: 'muted' }
  ];
  if (c.holidayWork) rep.summary.push({ label: 'ปฏิบัติงานวันหยุด', value: c.holidayWork, unit: 'คน', tone: 'navy' });
  rep.chart = {
    kind: 'doughnut',
    labels: ['ตรงเวลา', 'มาสาย', 'ลา', 'ขาดงาน', 'ยังไม่ลงเวลา'],
    data: [c.onTime, c.late, rows.filter(function (r) { return r.statusCode === 'LEAVE'; }).length, c.absent, c.notYet]
  };
  rep.params = { date: date };
  return rep;
}

/** รายงานรายเดือน */
function reportMonthly_(ctx, p) {
  var ym = parseYearMonth_(p);
  var from = monthStart_(ym.y, ym.m), to = monthEnd_(ym.y, ym.m);
  var emps = reportEmployees_(from, to);
  var res = computeAttendance_({ employees: emps, from: from, to: to });
  var rep = reportHeader_(ctx, 'monthly', 'รายงานสรุปการปฏิบัติงานประจำเดือน',
    'เดือน' + thaiMonthYear_(ym.y, ym.m) + ' (' + thaiDate_(from) + ' – ' + thaiDate_(to) + ')');
  var rows = [], sum = { present: 0, late: 0, leave: 0, absent: 0, incomplete: 0, rateSum: 0, rateN: 0 };
  res.people.forEach(function (pp) {
    var t = pp.totals;
    rows.push({
      no: rows.length + 1, staffCode: pp.emp.staffCode, fullName: pp.emp.fullName, position: pp.emp.position,
      workdays: t.workdays, present: t.present, late: t.late, lateMinutes: t.lateMinutes, leaveDays: t.leaveDays,
      absent: t.absent, incomplete: t.incomplete, avgIn: t.avgIn || '-', avgOut: t.avgOut || '-',
      rate: t.rate === null ? '-' : t.rate, employeeId: pp.emp.employeeId
    });
    sum.present += t.present; sum.late += t.late; sum.leave += t.leaveDays; sum.absent += t.absent; sum.incomplete += t.incomplete;
    if (t.rate !== null) { sum.rateSum += t.rate; sum.rateN++; }
  });
  var calendarWorkdays = res.dates.filter(function (d) { return res.infos[d].isWorkday; }).length;
  rep.tables.push({
    key: 'main', title: 'สถิติรายบุคคล',
    columns: [
      { key: 'no', label: 'ที่', align: 'center', width: 36 },
      { key: 'staffCode', label: 'รหัส', align: 'center', width: 70 },
      { key: 'fullName', label: 'ชื่อ-นามสกุล', width: 190 },
      { key: 'position', label: 'ตำแหน่ง', width: 120 },
      { key: 'workdays', label: 'วันทำงาน', align: 'center', width: 62, num: true },
      { key: 'present', label: 'มา (วัน)', align: 'center', width: 62, num: true },
      { key: 'late', label: 'สาย (ครั้ง)', align: 'center', width: 62, num: true },
      { key: 'leaveDays', label: 'ลา (วัน)', align: 'center', width: 62, num: true },
      { key: 'absent', label: 'ขาด (วัน)', align: 'center', width: 62, num: true },
      { key: 'incomplete', label: 'ไม่ครบ (ครั้ง)', align: 'center', width: 70, num: true },
      { key: 'avgIn', label: 'เข้าเฉลี่ย', align: 'center', width: 66 },
      { key: 'avgOut', label: 'ออกเฉลี่ย', align: 'center', width: 66 },
      { key: 'rate', label: 'ร้อยละการมา', align: 'center', width: 72, num: true }
    ],
    rows: rows
  });
  rep.summary = [
    { label: 'จำนวนบุคลากร', value: rows.length, unit: 'คน', tone: 'navy' },
    { label: 'วันทำงานตามปฏิทิน (ถึงปัจจุบัน)', value: calendarWorkdays, unit: 'วัน', tone: 'navy' },
    { label: 'รวมการมาปฏิบัติงาน', value: sum.present, unit: 'คน-วัน', tone: 'success' },
    { label: 'รวมการมาสาย', value: sum.late, unit: 'ครั้ง', tone: 'warning' },
    { label: 'รวมวันลา', value: sum.leave, unit: 'วัน', tone: 'sky' },
    { label: 'รวมวันขาดงาน', value: sum.absent, unit: 'วัน', tone: 'danger' },
    { label: 'ลงเวลาไม่ครบ', value: sum.incomplete, unit: 'ครั้ง', tone: 'warning' },
    { label: 'ร้อยละการมาปฏิบัติงานเฉลี่ย', value: sum.rateN ? round_(sum.rateSum / sum.rateN, 1) : '-', unit: '%', tone: 'success' }
  ];
  // กราฟรายวัน
  var series = { labels: [], onTime: [], late: [], leave: [], absent: [] };
  res.dates.forEach(function (date) {
    if (!res.infos[date].isWorkday) return;
    var c = { onTime: 0, late: 0, leave: 0, absent: 0 };
    res.people.forEach(function (pp) {
      pp.days.forEach(function (d) {
        if (d.date !== date) return;
        if (d.status === 'PRESENT') c.onTime++;
        else if (d.status === 'LATE') c.late++;
        else if (d.status === 'LEAVE') c.leave++;
        else if (d.status === 'ABSENT') c.absent++;
      });
    });
    series.labels.push(String(+date.substr(8, 2)));
    series.onTime.push(c.onTime); series.late.push(c.late); series.leave.push(c.leave); series.absent.push(c.absent);
  });
  rep.chart = { kind: 'stackedBar', series: series };
  rep.params = { year: ym.y, month: ym.m };
  return rep;
}

/** รายงานรายปี (ปีปฏิทิน ม.ค.–ธ.ค.) */
function reportYearly_(ctx, p) {
  var y = parseInt(p.year, 10);
  if (!isFinite(y) || y < 2000 || y > 2200) y = +todayStr_().substr(0, 4);
  var from = y + '-01-01', to = y + '-12-31';
  var emps = reportEmployees_(from, to);
  var res = computeAttendance_({ employees: emps, from: from, to: to });
  var rep = reportHeader_(ctx, 'yearly', 'รายงานสรุปการปฏิบัติงานประจำปี', 'ปี พ.ศ. ' + (y + 543) + ' (มกราคม – ธันวาคม)');
  var months = [];
  for (var m = 1; m <= 12; m++) months.push({ m: m, workdays: 0, present: 0, late: 0, leave: 0, absent: 0, incomplete: 0, denom: 0 });
  res.dates.forEach(function (d) { if (res.infos[d].isWorkday) months[+d.substr(5, 2) - 1].workdays++; });
  res.people.forEach(function (pp) {
    pp.days.forEach(function (d) {
      if (d.status === 'HOLIDAY' || d.status === 'HOLIDAY_WORK' || d.status === 'NOT_YET') return;
      var mm = months[+d.date.substr(5, 2) - 1];
      if (d.status === 'PRESENT' || d.status === 'LATE') mm.present++;
      if (d.status === 'LATE') mm.late++;
      var lv = d.leave ? (d.leave.period === 'FULL' ? 1 : 0.5) : 0;
      mm.leave += lv;
      if (d.status === 'ABSENT') mm.absent++;
      if (d.missingIn || d.missingOut) mm.incomplete++;
      mm.denom += 1 - lv;
    });
  });
  var monthRows = months.map(function (mm) {
    return {
      month: THAI_MONTHS[mm.m - 1], workdays: mm.workdays, present: mm.present, late: mm.late, leave: mm.leave,
      absent: mm.absent, incomplete: mm.incomplete, rate: mm.denom > 0 ? round_(Math.min(100, mm.present / mm.denom * 100), 1) : '-'
    };
  });
  var personRows = res.people.map(function (pp, i) {
    var t = pp.totals;
    return {
      no: i + 1, staffCode: pp.emp.staffCode, fullName: pp.emp.fullName, position: pp.emp.position,
      workdays: t.workdays, present: t.present, late: t.late, leaveDays: t.leaveDays, absent: t.absent,
      incomplete: t.incomplete, rate: t.rate === null ? '-' : t.rate, employeeId: pp.emp.employeeId
    };
  });
  rep.tables.push({
    key: 'months', title: 'เปรียบเทียบรายเดือน (หน่วย: คน-วัน)',
    columns: [
      { key: 'month', label: 'เดือน', width: 110 },
      { key: 'workdays', label: 'วันทำงาน', align: 'center', width: 70, num: true },
      { key: 'present', label: 'มาปฏิบัติงาน', align: 'center', width: 80, num: true },
      { key: 'late', label: 'มาสาย', align: 'center', width: 70, num: true },
      { key: 'leave', label: 'ลา', align: 'center', width: 70, num: true },
      { key: 'absent', label: 'ขาดงาน', align: 'center', width: 70, num: true },
      { key: 'incomplete', label: 'ลงเวลาไม่ครบ', align: 'center', width: 80, num: true },
      { key: 'rate', label: 'ร้อยละการมา', align: 'center', width: 80, num: true }
    ],
    rows: monthRows
  });
  rep.tables.push({
    key: 'people', title: 'สถิติรายบุคคลทั้งปี',
    columns: [
      { key: 'no', label: 'ที่', align: 'center', width: 36 },
      { key: 'staffCode', label: 'รหัส', align: 'center', width: 70 },
      { key: 'fullName', label: 'ชื่อ-นามสกุล', width: 190 },
      { key: 'position', label: 'ตำแหน่ง', width: 120 },
      { key: 'workdays', label: 'วันทำงาน', align: 'center', width: 62, num: true },
      { key: 'present', label: 'มา (วัน)', align: 'center', width: 62, num: true },
      { key: 'late', label: 'สาย (ครั้ง)', align: 'center', width: 62, num: true },
      { key: 'leaveDays', label: 'ลา (วัน)', align: 'center', width: 62, num: true },
      { key: 'absent', label: 'ขาด (วัน)', align: 'center', width: 62, num: true },
      { key: 'incomplete', label: 'ไม่ครบ (ครั้ง)', align: 'center', width: 70, num: true },
      { key: 'rate', label: 'ร้อยละการมา', align: 'center', width: 72, num: true }
    ],
    rows: personRows
  });
  var tot = months.reduce(function (a, mm) {
    a.present += mm.present; a.late += mm.late; a.leave += mm.leave; a.absent += mm.absent; a.incomplete += mm.incomplete; a.denom += mm.denom;
    return a;
  }, { present: 0, late: 0, leave: 0, absent: 0, incomplete: 0, denom: 0 });
  rep.summary = [
    { label: 'จำนวนบุคลากร', value: personRows.length, unit: 'คน', tone: 'navy' },
    { label: 'วันทำงานทั้งปี (ถึงปัจจุบัน)', value: months.reduce(function (a, mm) { return a + mm.workdays; }, 0), unit: 'วัน', tone: 'navy' },
    { label: 'รวมการมาปฏิบัติงาน', value: tot.present, unit: 'คน-วัน', tone: 'success' },
    { label: 'รวมการมาสาย', value: tot.late, unit: 'ครั้ง', tone: 'warning' },
    { label: 'รวมวันลา', value: tot.leave, unit: 'วัน', tone: 'sky' },
    { label: 'รวมวันขาดงาน', value: tot.absent, unit: 'วัน', tone: 'danger' },
    { label: 'ลงเวลาไม่ครบ', value: tot.incomplete, unit: 'ครั้ง', tone: 'warning' },
    { label: 'ร้อยละการมาปฏิบัติงานทั้งปี', value: tot.denom > 0 ? round_(Math.min(100, tot.present / tot.denom * 100), 1) : '-', unit: '%', tone: 'success' }
  ];
  rep.chart = {
    kind: 'yearTrend',
    labels: THAI_MONTHS_SHORT.slice(),
    present: months.map(function (mm) { return mm.present; }),
    late: months.map(function (mm) { return mm.late; }),
    leave: months.map(function (mm) { return mm.leave; }),
    absent: months.map(function (mm) { return mm.absent; }),
    rate: monthRows.map(function (r) { return r.rate === '-' ? null : r.rate; })
  };
  rep.params = { year: y };
  return rep;
}

/** รายงานรายบุคคล */
function reportIndividual_(ctx, p) {
  var emp = getEmployeeById_(String(p.employeeId || ''));
  if (!emp) throw appError_('กรุณาเลือกบุคลากร', 'VALIDATION');
  var today = todayStr_();
  var from = p.from ? validateDateParam_(p.from, 'วันที่เริ่มต้น') : monthStart_(+today.substr(0, 4), +today.substr(5, 2));
  var to = p.to ? validateDateParam_(p.to, 'วันที่สิ้นสุด') : today;
  if (to < from) throw appError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น', 'VALIDATION');
  if (daysBetween_(from, to) > 366) throw appError_('ช่วงวันที่ต้องไม่เกิน 1 ปี', 'VALIDATION');
  var res = computeAttendance_({ employees: [emp], from: from, to: to, withLogs: true });
  var pp = res.people[0];
  var rep = reportHeader_(ctx, 'individual', 'รายงานการลงเวลาปฏิบัติงานรายบุคคล',
    thaiDate_(from) + ' – ' + thaiDate_(to), 'landscape');
  rep.person = {
    fullName: emp.FullName, staffCode: emp.StaffCode, position: emp.Position,
    roleLabel: ROLE_LABELS[emp.Role], statusLabel: EMP_STATUS_LABELS[emp.Status]
  };
  var rows = pp.days.slice().reverse().map(function (d, i) {
    return {
      no: i + 1, date: d.dateShort, dayName: d.dayName,
      checkIn: d.checkIn ? d.checkIn.substr(0, 5) : '-', checkOut: d.checkOut ? d.checkOut.substr(0, 5) : '-',
      status: d.statusLabel, statusCode: d.status, lateMinutes: d.lateMinutes || '',
      inDistance: d.inDistanceM !== null && d.inDistanceM !== undefined ? d.inDistanceM : '',
      outDistance: d.outDistanceM !== null && d.outDistanceM !== undefined ? d.outDistanceM : '',
      note: d.note, inMaps: d.inMaps || null, outMaps: d.outMaps || null
    };
  });
  rep.tables.push({
    key: 'main', title: 'ผู้ปฏิบัติงาน: ' + emp.FullName + '  รหัส ' + emp.StaffCode + '  ตำแหน่ง ' + emp.Position,
    columns: [
      { key: 'no', label: 'ที่', align: 'center', width: 36 },
      { key: 'date', label: 'วันที่', align: 'center', width: 80 },
      { key: 'dayName', label: 'วัน', align: 'center', width: 70 },
      { key: 'checkIn', label: 'เวลาเข้า', align: 'center', width: 66 },
      { key: 'checkOut', label: 'เวลาออก', align: 'center', width: 66 },
      { key: 'status', label: 'สถานะ', align: 'center', width: 110 },
      { key: 'lateMinutes', label: 'สาย (นาที)', align: 'center', width: 66 },
      { key: 'inDistance', label: 'ระยะเข้า (ม.)', align: 'center', width: 76 },
      { key: 'outDistance', label: 'ระยะออก (ม.)', align: 'center', width: 76 },
      { key: 'note', label: 'หมายเหตุ', width: 220 }
    ],
    rows: rows
  });
  var leaves = readAll_('LeaveRequests').filter(function (l) {
    return l.EmployeeID === emp.EmployeeID && l.EndDate >= from && l.StartDate <= to && l.Status !== 'CANCELLED';
  }).map(function (l, i) {
    return {
      no: i + 1, type: leaveTypeLabel_(l),
      period: thaiDate_(l.StartDate, 'short') + (l.EndDate !== l.StartDate ? ' – ' + thaiDate_(l.EndDate, 'short') : '') +
        (l.Period && l.Period !== 'FULL' ? ' (' + LEAVE_PERIODS[l.Period] + ')' : ''),
      days: l.Days, status: REQUEST_STATUS_LABELS[l.Status], reason: l.Reason
    };
  });
  if (leaves.length) {
    rep.tables.push({
      key: 'leaves', title: 'รายการลาในช่วงเวลา',
      columns: [
        { key: 'no', label: 'ที่', align: 'center', width: 36 },
        { key: 'type', label: 'ประเภท', width: 90 },
        { key: 'period', label: 'ช่วงวันที่', width: 200 },
        { key: 'days', label: 'จำนวนวัน', align: 'center', width: 70, num: true },
        { key: 'status', label: 'สถานะ', align: 'center', width: 90 },
        { key: 'reason', label: 'เหตุผล', width: 260 }
      ],
      rows: leaves
    });
  }
  var t = pp.totals;
  rep.summary = [
    { label: 'วันทำงาน', value: t.workdays, unit: 'วัน', tone: 'navy' },
    { label: 'มาปฏิบัติงาน', value: t.present, unit: 'วัน', tone: 'success' },
    { label: 'มาสาย', value: t.late, unit: 'ครั้ง (' + t.lateMinutes + ' นาที)', tone: 'warning' },
    { label: 'ลา', value: t.leaveDays, unit: 'วัน', tone: 'sky' },
    { label: 'ขาดงาน', value: t.absent, unit: 'วัน', tone: 'danger' },
    { label: 'ลงเวลาไม่ครบ', value: t.incomplete, unit: 'ครั้ง', tone: 'warning' },
    { label: 'เวลาเข้างานเฉลี่ย', value: t.avgIn || '-', unit: 'น.', tone: 'navy' },
    { label: 'เวลาออกงานเฉลี่ย', value: t.avgOut || '-', unit: 'น.', tone: 'navy' },
    { label: 'ร้อยละการมาปฏิบัติงาน', value: t.rate === null ? '-' : t.rate, unit: '%', tone: 'success' }
  ];
  if (t.holidayWork) rep.summary.push({ label: 'ปฏิบัติงานวันหยุด', value: t.holidayWork, unit: 'วัน', tone: 'navy' });
  rep.params = { employeeId: emp.EmployeeID, from: from, to: to };
  return rep;
}

/**
 * รายงานสรุปวันลา มาสาย และขาดงาน รายรอบการประเมิน
 * (ใช้ประกอบการพิจารณาเลื่อนเงินเดือน: รอบที่ 1 = 1 ต.ค. – 31 มี.ค., รอบที่ 2 = 1 เม.ย. – 30 ก.ย.)
 * นับเฉพาะใบลาที่อนุมัติแล้ว; ลาป่วย/ลากิจ/ลาพักผ่อนนับวันทำการ, ลาคลอดบุตรนับวันต่อเนื่อง
 */
function reportLeaveSummary_(ctx, p) {
  var fy = parseFiscalYear_(p.fiscalYear);
  var round = [0, 1, 2].indexOf(parseInt(p.round, 10)) >= 0 ? parseInt(p.round, 10) : 0;
  var r = fiscalRange_(fy, round);
  var emps = reportEmployees_(r.from, r.to);
  var res = computeAttendance_({ employees: emps, from: r.from, to: r.to });
  var byEmp = {};
  readAll_('LeaveRequests').forEach(function (l) { (byEmp[l.EmployeeID] = byEmp[l.EmployeeID] || []).push(l); });
  var tot = { sickT: 0, sickD: 0, persT: 0, persD: 0, late: 0, absent: 0, perfect: 0 };
  var rows = res.people.map(function (pp, i) {
    var lt = leaveTotals_(byEmp[pp.emp.employeeId] || [], r.from, r.to);
    var late = 0, absent = 0;
    pp.days.forEach(function (d) { if (d.status === 'LATE') late++; if (d.status === 'ABSENT') absent++; });
    var leaveCount = Object.keys(lt).reduce(function (a, k) { return a + (k === 'OFFICIAL' ? 0 : lt[k].times); }, 0);
    tot.sickT += lt.SICK.times; tot.sickD += lt.SICK.days; tot.persT += lt.PERSONAL.times; tot.persD += lt.PERSONAL.days;
    tot.late += late; tot.absent += absent;
    if (!leaveCount && !late && !absent && pp.totals.workdays > 0) tot.perfect++;
    return {
      no: i + 1, staffCode: pp.emp.staffCode, fullName: pp.emp.fullName, position: pp.emp.position,
      sickT: lt.SICK.times, sickD: lt.SICK.days, persT: lt.PERSONAL.times, persD: lt.PERSONAL.days,
      spT: lt.SICK.times + lt.PERSONAL.times, spD: round_(lt.SICK.days + lt.PERSONAL.days, 1),
      vacD: lt.VACATION.days, matD: lt.MATERNITY.days, othD: lt.OTHER.days, offD: lt.OFFICIAL.days,
      late: late, absent: absent, employeeId: pp.emp.employeeId
    };
  });
  var rep = reportHeader_(ctx, 'leaveSummary', 'บัญชีสรุปวันลา มาสาย และขาดงาน', r.label + ' (' + r.rangeLabel + ')');
  rep.tables.push({
    key: 'people', title: 'นับเฉพาะใบลาที่อนุมัติแล้ว · ลาป่วย/ลากิจ/ลาพักผ่อนนับวันทำการ · ลาคลอดบุตรนับวันต่อเนื่อง',
    columns: [
      { key: 'no', label: 'ที่', align: 'center', width: 32 },
      { key: 'fullName', label: 'ชื่อ-นามสกุล', width: 170 },
      { key: 'position', label: 'ตำแหน่ง', width: 96 },
      { key: 'sickT', label: 'ลาป่วย (ครั้ง)', align: 'center', width: 52, num: true },
      { key: 'sickD', label: 'ลาป่วย (วัน)', align: 'center', width: 52, num: true },
      { key: 'persT', label: 'ลากิจ (ครั้ง)', align: 'center', width: 52, num: true },
      { key: 'persD', label: 'ลากิจ (วัน)', align: 'center', width: 52, num: true },
      { key: 'spT', label: 'ป่วย+กิจ (ครั้ง)', align: 'center', width: 56, num: true },
      { key: 'spD', label: 'ป่วย+กิจ (วัน)', align: 'center', width: 56, num: true },
      { key: 'vacD', label: 'ลาพักผ่อน (วัน)', align: 'center', width: 56, num: true },
      { key: 'matD', label: 'ลาคลอดบุตร (วัน)', align: 'center', width: 60, num: true },
      { key: 'othD', label: 'ลาอื่น ๆ (วัน)', align: 'center', width: 52, num: true },
      { key: 'offD', label: 'ไปราชการ (วัน)', align: 'center', width: 56, num: true },
      { key: 'late', label: 'มาสาย (ครั้ง)', align: 'center', width: 52, num: true },
      { key: 'absent', label: 'ขาดงาน (วัน)', align: 'center', width: 52, num: true }
    ],
    rows: rows
  });
  rep.summary = [
    { label: 'จำนวนบุคลากร', value: rows.length, unit: 'คน', tone: 'navy' },
    { label: 'ลาป่วยรวม', value: round_(tot.sickD, 1), unit: 'วัน (' + tot.sickT + ' ครั้ง)', tone: 'sky' },
    { label: 'ลากิจรวม', value: round_(tot.persD, 1), unit: 'วัน (' + tot.persT + ' ครั้ง)', tone: 'sky' },
    { label: 'มาสายรวม', value: tot.late, unit: 'ครั้ง', tone: 'warning' },
    { label: 'ขาดงานรวม', value: tot.absent, unit: 'วัน', tone: 'danger' },
    { label: 'ไม่ลา ไม่สาย ไม่ขาด', value: tot.perfect, unit: 'คน', tone: 'success' }
  ];
  if (r.from > res.today) rep.notice = 'รอบนี้ยังไม่เริ่ม';
  else if (r.to > res.today) rep.notice = 'ข้อมูลถึงวันที่ ' + thaiDate_(res.today) + ' (รอบยังไม่สิ้นสุด)';
  rep.params = { fiscalYear: fy, round: round };
  return rep;
}

function buildReportByType_(ctx, type, params) {
  if (type === 'daily') return reportDaily_(ctx, params || {});
  if (type === 'monthly') return reportMonthly_(ctx, params || {});
  if (type === 'yearly') return reportYearly_(ctx, params || {});
  if (type === 'individual') return reportIndividual_(ctx, params || {});
  if (type === 'leaveSummary') return reportLeaveSummary_(ctx, params || {});
  throw appError_('ประเภทรายงานไม่ถูกต้อง', 'VALIDATION');
}

/* ========================================================================== */
/*  Export: Excel (.xlsx) / PDF                                               */
/* ========================================================================== */

/**
 * ส่งออกรายงาน: สร้าง Google Sheet ชั่วคราวพร้อมหัวกระดาษทางการ → export → ลบไฟล์ (ย้ายไปถังขยะ)
 * @param {{reportType: string, params: Object, format: 'xlsx'|'pdf'}} p
 */
function exportReport_(ctx, p) {
  var format = p.format === 'pdf' ? 'pdf' : 'xlsx';
  var report = buildReportByType_(ctx, String(p.reportType || ''), p.params || {});
  var baseName = exportFileBase_(report);
  var ss = SpreadsheetApp.create('TEMP-' + report.title + ' ' + report.periodLabel.replace(/[\\\/:*?"<>|]/g, '-'));
  var file = DriveApp.getFileById(ss.getId());
  try {
    var folderId = scriptProps_().EXPORT_FOLDER_ID;
    if (folderId) {
      try { file.moveTo(DriveApp.getFolderById(folderId)); } catch (e) { /* ใช้ตำแหน่งเดิม */ }
    }
    ss.setSpreadsheetTimeZone(APP.TZ);
    var sh = ss.getSheets()[0];
    sh.setName('รายงาน');
    writeReportToSheet_(sh, report);
    SpreadsheetApp.flush();
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?';
    if (format === 'pdf') {
      url += [
        'format=pdf', 'size=A4', 'portrait=' + (report.orientation === 'portrait'), 'fitw=true',
        'gridlines=false', 'printtitle=false', 'sheetnames=false', 'pagenum=CENTER', 'fzr=false',
        'top_margin=0.5', 'bottom_margin=0.5', 'left_margin=0.4', 'right_margin=0.4',
        'horizontal_alignment=CENTER', 'gid=' + sh.getSheetId()
      ].join('&');
    } else {
      url += 'format=xlsx';
    }
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      console.error('Export failed: HTTP ' + resp.getResponseCode());
      throw appError_('ส่งออกรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'EXPORT_FAILED');
    }
    var bytes = resp.getBlob().getBytes();
    if (bytes.length > 25 * 1024 * 1024) throw appError_('ไฟล์รายงานมีขนาดใหญ่เกินไป กรุณาลดช่วงวันที่', 'EXPORT_FAILED');
    writeAudit_(ctx, 'REPORT_EXPORT', 'Report', report.type, { format: format, params: report.params });
    return {
      fileName: baseName + (format === 'pdf' ? '.pdf' : '.xlsx'),
      mimeType: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Utilities.base64Encode(bytes)
    };
  } finally {
    try { file.setTrashed(true); } catch (e2) { console.error('trash temp export failed: ' + e2); }
  }
}

/**
 * ชื่อไฟล์ส่งออกเป็นอักษรอังกฤษ/ตัวเลข (เบราว์เซอร์และระบบปฏิบัติการบางรุ่นตัดชื่อไฟล์ภาษาไทยทิ้ง)
 * ชื่อรายงานภาษาไทยอยู่ในหัวกระดาษของไฟล์แล้ว
 */
function exportFileBase_(report) {
  var p = report.params || {};
  var name;
  if (report.type === 'daily') name = 'Daily_' + p.date;
  else if (report.type === 'monthly') name = 'Monthly_' + p.year + '-' + pad2_(p.month);
  else if (report.type === 'yearly') name = 'Yearly_' + p.year;
  else if (report.type === 'leaveSummary') name = 'LeaveSummary_FY' + p.fiscalYear + (p.round ? '_R' + p.round : '');
  else {
    var e = getEmployeeById_(p.employeeId);
    name = 'Individual_' + (e ? String(e.StaffCode).replace(/[^A-Za-z0-9-]/g, '') : 'staff') + '_' + p.from + '_' + p.to;
  }
  return 'WatSaoHin_Attendance_' + name;
}

/** เขียนรายงานลงชีตพร้อมหัวกระดาษอย่างเป็นทางการ */
function writeReportToSheet_(sh, report) {
  var ncols = 1;
  report.tables.forEach(function (t) { ncols = Math.max(ncols, t.columns.length); });
  var values = [];
  var styles = []; // {row, kind, cols}
  function pushRow(cells, kind) {
    var row = [];
    for (var i = 0; i < ncols; i++) row.push(i < cells.length ? cells[i] : '');
    values.push(row);
    styles.push({ row: values.length, kind: kind });
  }
  function txt(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return v;
    return "'" + String(v);
  }
  pushRow([txt(report.school)], 'school');
  pushRow([txt(report.title)], 'title');
  pushRow([txt('ช่วงวันที่: ' + report.periodLabel)], 'meta');
  if (report.notice) pushRow([txt('หมายเหตุ: ' + report.notice)], 'meta');
  pushRow([txt('วันที่จัดทำรายงาน: ' + report.generatedAt + '    ผู้จัดทำ: ' + report.generatedBy)], 'meta');
  pushRow([], 'blank');
  report.tables.forEach(function (t) {
    if (t.title) pushRow([txt(t.title)], 'tableTitle');
    pushRow(t.columns.map(function (c) { return txt(c.label); }), 'header');
    var first = values.length + 1;
    t.rows.forEach(function (r) {
      pushRow(t.columns.map(function (c) {
        var v = r[c.key];
        return c.num && typeof v === 'number' ? v : txt(v === undefined ? '' : v);
      }), 'data');
    });
    if (!t.rows.length) pushRow([txt('— ไม่มีข้อมูล —')], 'empty');
    styles.push({ kind: 'tableBlock', from: first - 1, to: values.length, cols: t.columns.length, columns: t.columns });
    pushRow([], 'blank');
  });
  pushRow([txt('สรุปผล')], 'tableTitle');
  report.summary.forEach(function (s) {
    pushRow([txt('• ' + s.label + ': ' + s.value + ' ' + (s.unit || ''))], 'summary');
  });
  pushRow([], 'blank');
  pushRow([txt('ลงชื่อ ......................................................... ผู้จัดทำรายงาน')], 'sign');
  pushRow([txt('( ' + report.generatedBy + ' )')], 'sign');
  pushRow([], 'blank');
  var signer = report.signer || {};
  pushRow([txt('ลงชื่อ ......................................................... ' + (signer.position || 'ผู้อำนวยการโรงเรียน'))], 'sign');
  pushRow([txt('( ' + (signer.name || '.........................................................') + ' )')], 'sign');

  ensureRows_(sh, values.length);
  if (sh.getMaxColumns() < ncols) sh.insertColumnsAfter(sh.getMaxColumns(), ncols - sh.getMaxColumns());
  var all = sh.getRange(1, 1, values.length, ncols);
  all.setValues(values);

  // สร้างเมทริกซ์รูปแบบ แล้วตั้งค่าครั้งเดียว (ประหยัดจำนวนการเรียก API)
  function matrix(v) {
    var m = [];
    for (var i = 0; i < values.length; i++) { var r = []; for (var j = 0; j < ncols; j++) r.push(v); m.push(r); }
    return m;
  }
  var bg = matrix('#FFFFFF'), fc = matrix('#0F172A'), fw = matrix('normal'), fs = matrix(11), ha = matrix('left');
  var merges = [];
  var dataIndex = 0;
  styles.forEach(function (st) {
    if (st.kind === 'tableBlock') {
      st.columns.forEach(function (c, ci) {
        for (var r = st.from + 1; r <= st.to; r++) if (c.align === 'center') ha[r - 1][ci] = 'center';
      });
      return;
    }
    var i = st.row - 1, j;
    switch (st.kind) {
      case 'school':
        merges.push(st.row); for (j = 0; j < ncols; j++) { fs[i][j] = 16; fw[i][j] = 'bold'; ha[i][j] = 'center'; fc[i][j] = '#0B2545'; } break;
      case 'title':
        merges.push(st.row); for (j = 0; j < ncols; j++) { fs[i][j] = 14; fw[i][j] = 'bold'; ha[i][j] = 'center'; fc[i][j] = '#0B2545'; } break;
      case 'meta':
        merges.push(st.row); for (j = 0; j < ncols; j++) { ha[i][j] = 'center'; fc[i][j] = '#334155'; } break;
      case 'tableTitle':
        merges.push(st.row); for (j = 0; j < ncols; j++) { fw[i][j] = 'bold'; fs[i][j] = 12; fc[i][j] = '#13315C'; } break;
      case 'header':
        dataIndex = 0;
        for (j = 0; j < ncols; j++) { fw[i][j] = 'bold'; bg[i][j] = '#13315C'; fc[i][j] = '#FFFFFF'; ha[i][j] = 'center'; } break;
      case 'data':
        dataIndex++;
        if (dataIndex % 2 === 0) for (j = 0; j < ncols; j++) bg[i][j] = '#F1F6FC';
        break;
      case 'empty':
        merges.push(st.row); for (j = 0; j < ncols; j++) { ha[i][j] = 'center'; fc[i][j] = '#64748B'; } break;
      case 'summary':
        merges.push(st.row); break;
      case 'sign':
        merges.push(st.row); for (j = 0; j < ncols; j++) ha[i][j] = 'right'; break;
      default: break;
    }
  });
  all.setFontFamily('Sarabun').setVerticalAlignment('middle').setWrap(true)
    .setBackgrounds(bg).setFontColors(fc).setFontWeights(fw).setFontSizes(fs).setHorizontalAlignments(ha);
  merges.forEach(function (row) { if (ncols > 1) sh.getRange(row, 1, 1, ncols).merge(); });
  styles.forEach(function (st) {
    if (st.kind === 'tableBlock') {
      sh.getRange(st.from, 1, st.to - st.from + 1, st.cols)
        .setBorder(true, true, true, true, true, true, '#94A3B8', SpreadsheetApp.BorderStyle.SOLID);
    }
  });

  // ความกว้างคอลัมน์ตามตารางที่กว้างที่สุด
  var widest = report.tables.reduce(function (a, t) { return t.columns.length > a.columns.length ? t : a; }, report.tables[0]);
  if (widest) widest.columns.forEach(function (c, i) { sh.setColumnWidth(i + 1, Math.max(40, Math.round((c.width || 90) * 1.1))); });
  sh.setHiddenGridlines(true);
}
