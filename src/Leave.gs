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
    oldAttendanceId: r.OldAttendanceID, newAttendanceId: r.NewAttendanceID
  };
}

function submitCorrection_(ctx, p) {
  var emp = ctx.user, s = ctx.settings;
  var date = String(p.date || '');
  var type = String(p.type || '');
  var time = String(p.time || '');
  var today = todayStr_();
  if (!isValidYmd_(date)) throw appError_('กรุณาเลือกวันที่ที่ต้องการแก้ไข', 'VALIDATION', { field: 'date' });
  if (date > today) throw appError_('ไม่สามารถแก้ไขเวลาของวันในอนาคตได้', 'VALIDATION', { field: 'date' });
  if (date < addDays_(today, -s.correctionMaxDays)) {
    throw appError_('ยื่นคำร้องย้อนหลังได้ไม่เกิน ' + s.correctionMaxDays + ' วัน', 'VALIDATION', { field: 'date' });
  }
  if (emp.ActiveFrom && date < emp.ActiveFrom) throw appError_('วันที่เลือกอยู่ก่อนวันที่บัญชีเริ่มใช้งาน', 'VALIDATION', { field: 'date' });
  if (!ATT_TYPES[type]) throw appError_('กรุณาเลือกประเภท เวลาเข้า หรือ เวลาออก', 'VALIDATION', { field: 'type' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw appError_('กรุณาระบุเวลาให้ถูกต้อง (ชั่วโมง:นาที)', 'VALIDATION', { field: 'time' });
  if (date === today && time + ':00' > nowTimeStr_()) throw appError_('เวลาที่แจ้งต้องไม่เกินเวลาปัจจุบัน', 'VALIDATION', { field: 'time' });
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
      OldAttendanceID: '', NewAttendanceID: ''
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
  var s = ctx.settings;
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
      Note: 'อนุมัติโดย ' + ctx.user.FullName + (note ? ' — ' + note : '')
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
    var after = updateRecord_('CorrectionRequests', r._row, {
      Status: 'APPROVED', ReviewedBy: ctx.user.EmployeeID, ReviewedByName: ctx.user.FullName, ReviewedAt: nowStamp_(),
      ReviewNote: note, OldAttendanceID: oldId || '', NewAttendanceID: newId
    });
    return { before: r, after: after, oldLog: oldLog, newLog: newLog };
  });
  writeAudit_(ctx, 'CORRECTION_' + decision, 'CorrectionRequest', out.after.RequestID, {
    employee: out.after.FullName, date: out.after.Date, type: out.after.Type, requestedTime: out.after.RequestedTime,
    oldRecord: out.oldLog ? { id: out.oldLog.AttendanceID, time: out.oldLog.Time, status: out.oldLog.Status, source: out.oldLog.Source } : null,
    newRecord: out.newLog ? { id: out.newLog.AttendanceID, time: out.newLog.Time, status: out.newLog.Status } : null,
    note: note
  });
  return { request: correctionView_(out.after), message: decision === 'APPROVE' ? 'อนุมัติคำร้องและปรับเวลาเรียบร้อยแล้ว' : 'ไม่อนุมัติคำร้องแล้ว' };
}
