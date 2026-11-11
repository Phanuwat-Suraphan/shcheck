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
      ['NewAttendanceID', 'str', 'รหัสรายการใหม่ที่สร้างจากคำร้อง']
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
  var msg = 'ลบพิกัด GPS ที่เก่ากว่า ' + thaiDate_(cutoff) + ' จำนวน ' + purged + ' รายการ, ลบไฟล์รายงานชั่วคราว ' + cleaned + ' ไฟล์' +
    (holidaysAdded ? ', เพิ่มวันหยุดราชการไทย ' + holidaysAdded + ' วัน' : '');
  if (purged || holidaysAdded || ctx) writeAudit_(ctx, 'MAINTENANCE', 'SYSTEM', '', { gpsPurged: purged, cutoff: cutoff, tempFilesRemoved: cleaned, holidaysAdded: holidaysAdded });
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
