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
      status: d.status, statusLabel: d.statusLabel, note: d.note, lateMinutes: d.lateMinutes
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
  if (!s.settingsConfirmed) warnings.push('การตั้งค่าเวลาทำงาน/รัศมี GPS ยังเป็นค่าตัวอย่าง กรุณาตรวจสอบให้ตรงกับระเบียบของโรงเรียนแล้วกดยืนยันในหน้าตั้งค่า');
  var storage = driveStorageInfo_();
  if (storage && storage.percent >= 85) {
    warnings.push('พื้นที่ Google Drive ของบัญชีระบบใช้ไปแล้ว ' + storage.percent + '% (' + storage.usedLabel + ' จาก ' + storage.limitLabel +
      ') หากเต็ม ระบบจะบันทึกการลงเวลาไม่ได้ กรุณาลบไฟล์ที่ไม่ใช้/ล้างถังขยะ/ลบอีเมลเก่า หรือเพิ่มพื้นที่');
  }
  var info = getDayInfo_(today, s);
  return {
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
      corrections: readAll_('CorrectionRequests').filter(function (r) { return r.Status === 'PENDING'; }).length
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
  var data = validateEmployeeInput_(p, { requirePassword: false });
  var role = validRole_(String(p.role || ROLES.USER));
  var temp = generateTempPassword_(12);
  var hash = hashPassword_(temp);
  var rec = withLock_(function () {
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
      SessionVersion: (Number(t.SessionVersion) || 0) + 1, UpdatedAt: nowStamp_()
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
  WORK_START_TIME: { type: 'time', label: 'เวลาเริ่มปฏิบัติงาน' },
  LATE_AFTER_TIME: { type: 'time', label: 'เวลาที่ถือว่ามาสาย' },
  WORK_END_TIME: { type: 'time', label: 'เวลาเลิกงาน' },
  CHECKIN_EARLIEST_TIME: { type: 'time', label: 'เวลาเปิดให้ลงเวลาเข้า' },
  WORK_DAYS: { type: 'workdays', label: 'วันทำงานประจำสัปดาห์' },
  ALLOW_HOLIDAY_CHECKIN: { type: 'bool', label: 'อนุญาตลงเวลาวันหยุด' },
  SESSION_TIMEOUT_MIN: { type: 'int', min: 5, max: 360, label: 'หมดเวลาการใช้งาน (นาที)' },
  MAX_LOGIN_ATTEMPTS: { type: 'int', min: 3, max: 20, label: 'จำนวนครั้งที่ใส่รหัสผิดได้' },
  LOCKOUT_MIN: { type: 'int', min: 1, max: 1440, label: 'ระยะเวลาล็อกบัญชี (นาที)' },
  GPS_RETENTION_DAYS: { type: 'int', min: 30, max: 3650, label: 'ระยะเวลาเก็บพิกัด GPS (วัน)' },
  CORRECTION_MAX_DAYS: { type: 'int', min: 1, max: 365, label: 'ยื่นคำร้องย้อนหลังได้ (วัน)' },
  ALLOW_REGISTRATION: { type: 'bool', label: 'เปิดรับสมัครสมาชิก' },
  LEAVE_REQUIRES_APPROVAL: { type: 'bool', label: 'การลาที่บุคลากรบันทึกเองต้องรออนุมัติ' },
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

/** วันหยุดราชการที่มีวันที่คงที่ทุกปี (ตัวอย่าง — ต้องตรวจสอบกับประกาศของทางราชการแต่ละปี) */
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

function calendarView_(r) {
  return {
    date: r.Date, dateLabel: thaiDate_(r.Date, 'long'), type: r.Type, typeLabel: CALENDAR_TYPES[r.Type] || r.Type,
    title: r.Title, createdBy: r.CreatedBy
  };
}

function listCalendar_(ctx, p) {
  var y = parseInt(p.year, 10);
  if (!isFinite(y) || y < 2000 || y > 2200) y = +todayStr_().substr(0, 4);
  var s = getSettings_();
  var entries = readAll_('WorkCalendar').filter(function (r) { return String(r.Date).substr(0, 4) === String(y); })
    .sort(function (a, b) { return a.Date < b.Date ? -1 : 1; }).map(calendarView_);
  return {
    year: y, entries: entries,
    workDays: s.workDays, workDayNames: s.workDays.map(function (d) { return THAI_DAYS[d]; }),
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
    var added = [], updated = 0;
    dates.forEach(function (d) {
      if (byDate[d]) {
        updateRecord_('WorkCalendar', byDate[d]._row, { Type: type, Title: title, CreatedBy: ctx.user.FullName, CreatedAt: nowStamp_() });
        updated++;
      } else {
        added.push({ Date: d, Type: type, Title: title, CreatedBy: ctx.user.FullName, CreatedAt: nowStamp_() });
      }
    });
    appendRecords_('WorkCalendar', added);
    return { added: added.length, updated: updated };
  });
  writeAudit_(ctx, 'CALENDAR_ADD', 'WorkCalendar', start + (end !== start ? '..' + end : ''), { type: type, title: title, added: res.added, updated: res.updated });
  return { message: 'บันทึกปฏิทินแล้ว (เพิ่ม ' + res.added + ' วัน, ปรับปรุง ' + res.updated + ' วัน)' };
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

function addFixedHolidays_(ctx, p) {
  var y = parseInt(p.year, 10);
  if (!isFinite(y) || y < 2000 || y > 2200) throw appError_('ปีไม่ถูกต้อง', 'VALIDATION');
  var res = withLock_(function () {
    var existing = {};
    readAll_('WorkCalendar').forEach(function (r) { existing[r.Date] = true; });
    var add = [];
    FIXED_HOLIDAYS_.forEach(function (h) {
      var d = y + '-' + h[0];
      if (!existing[d]) add.push({ Date: d, Type: 'OFFICIAL_HOLIDAY', Title: h[1], CreatedBy: ctx.user.FullName, CreatedAt: nowStamp_() });
    });
    appendRecords_('WorkCalendar', add);
    return add.length;
  });
  writeAudit_(ctx, 'CALENDAR_ADD_FIXED', 'WorkCalendar', String(y), { added: res });
  return {
    message: 'เพิ่มวันหยุดราชการ (วันที่คงที่) ปี พ.ศ. ' + (y + 543) + ' จำนวน ' + res + ' วัน ' +
      'กรุณาเพิ่มวันหยุดทางพุทธศาสนา วันหยุดชดเชย และวันหยุดพิเศษตามประกาศของทางราชการเอง'
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
