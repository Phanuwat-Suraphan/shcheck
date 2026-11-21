/**
 * ============================================================================
 *  SignOff.gs — ลายเซ็นสแกน และการลงนามรับรองบัญชีลงเวลาประจำวัน
 * ============================================================================
 *  - ผู้บริหาร/ผู้ดูแลระบบอัปโหลด "ลายเซ็นของตนเอง" (หน้าเว็บลบพื้นหลัง ครอป และย่อเป็น PNG ให้แล้ว)
 *    ลายเซ็นถูกใช้เฉพาะเมื่อเจ้าของลายเซ็นกดลงนามเอง — ไม่มีใครนำลายเซ็นของผู้อื่นไปใช้ได้
 *  - ลงนามได้วันละ 2 บทบาท: CERTIFIER = "ตรวจแล้วถูกต้อง" (ผู้อำนวยการ/ผู้รักษาราชการแทน)
 *                          CHECKER   = ผู้ตรวจสอบ (คนละคนกับผู้รับรองของวันเดียวกัน)
 *  - ลงนามย้อนหลังได้ทุกวันตั้งแต่วันเริ่มใช้ระบบ และเลือกหลายวันได้ในครั้งเดียว
 *    (วันนี้ลงนามได้หลังเวลาเลิกงาน) — บันทึกวันเวลาที่ลงนามจริงไว้เสมอ
 *  - บัญชีลงเวลาที่พิมพ์แสดงภาพลายเซ็นเฉพาะวันที่ลงนามแล้ว
 * ============================================================================
 */

var SIGN_ROLES = { CERTIFIER: 'ผู้รับรอง (ตรวจแล้วถูกต้อง)', CHECKER: 'ผู้ตรวจสอบ' };
var SIGNATURE_MAX_CHARS_ = 45000; // 1 ช่องของ Google Sheets เก็บได้ไม่เกิน 50,000 ตัวอักษร
var SIGNOFF_MAX_DAYS_ = 62;

/* ---------- ลายเซ็นของฉัน ---------- */

function mySignatureRecord_(empId) {
  return findOne_('Signatures', 'EmployeeID', empId);
}

function signatureView_(rec) {
  return {
    image: rec && rec.ImageData ? rec.ImageData : '',
    updatedLabel: rec && rec.UpdatedAt ? thaiStamp_(rec.UpdatedAt) : ''
  };
}

/** ตรวจภาพลายเซ็น: ต้องเป็น PNG (data URL) ขนาดพอเหมาะ — กันไฟล์ชนิดอื่นและข้อมูลขนาดใหญ่ */
function validateSignatureImage_(img) {
  img = String(img || '');
  var bad = 'ไฟล์ลายเซ็นไม่ถูกต้อง กรุณาเลือกภาพลายเซ็นใหม่';
  var m = /^data:image\/png;base64,([A-Za-z0-9+\/]+={0,2})$/.exec(img);
  if (!m) throw appError_(bad, 'VALIDATION');
  if (img.length > SIGNATURE_MAX_CHARS_) {
    throw appError_('ภาพลายเซ็นมีรายละเอียดมากเกินไป กรุณาถ่ายให้เห็นเฉพาะลายเซ็นบนกระดาษขาวแล้วลองใหม่', 'VALIDATION');
  }
  var b;
  try { b = Utilities.base64Decode(m[1]); } catch (e) { throw appError_(bad, 'VALIDATION'); }
  var head = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]; // PNG + IHDR
  if (b.length < 33) throw appError_(bad, 'VALIDATION');
  for (var i = 0; i < head.length; i++) if ((b[i] & 255) !== head[i]) throw appError_('ไฟล์ลายเซ็นต้องเป็นภาพ PNG', 'VALIDATION');
  var u32 = function (o) { return (b[o] & 255) * 16777216 + (b[o + 1] & 255) * 65536 + (b[o + 2] & 255) * 256 + (b[o + 3] & 255); };
  var w = u32(16), h = u32(20);
  if (w < 40 || w > 1000 || h < 15 || h > 500) {
    throw appError_('ขนาดภาพลายเซ็นไม่เหมาะสม (' + w + '×' + h + ' px) กรุณาถ่ายให้เห็นเฉพาะลายเซ็น', 'VALIDATION');
  }
  return { data: img, width: w, height: h };
}

function saveMySignature_(ctx, p) {
  var v = validateSignatureImage_(p && p.image);
  var stamp = nowStamp_();
  withLock_(function () {
    var rec = mySignatureRecord_(ctx.user.EmployeeID);
    var patch = { ImageData: v.data, Width: v.width, Height: v.height, UpdatedAt: stamp };
    if (rec) {
      updateRecord_('Signatures', rec._row, patch);
    } else {
      patch.EmployeeID = ctx.user.EmployeeID;
      appendRecord_('Signatures', patch);
    }
  });
  writeAudit_(ctx, 'SIGNATURE_UPDATE', 'Employee', ctx.user.EmployeeID, { width: v.width, height: v.height, size: v.data.length });
  var out = signatureView_({ ImageData: v.data, UpdatedAt: stamp });
  out.message = 'บันทึกลายเซ็นแล้ว';
  return out;
}

function removeMySignature_(ctx) {
  var removed = withLock_(function () {
    var rec = mySignatureRecord_(ctx.user.EmployeeID);
    if (!rec) return false;
    deleteRowNumber_('Signatures', rec._row);
    return true;
  });
  if (!removed) throw appError_('ยังไม่มีลายเซ็นที่บันทึกไว้', 'NOT_FOUND');
  writeAudit_(ctx, 'SIGNATURE_REMOVE', 'Employee', ctx.user.EmployeeID, null);
  return { message: 'ลบลายเซ็นแล้ว — วันที่ลงนามไว้จะพิมพ์เป็นช่องว่างให้ลงชื่อด้วยปากกาแทน' };
}

/* ---------- การลงนามรับรอง ---------- */

/** วันแรกที่มีบัญชีลงเวลา: วันเริ่มใช้ระบบจริง (ถ้าตั้งไว้) หรือวันที่อนุมัติบัญชีแรกสุด */
function signOffStart_() {
  var s = getSettings_();
  if (s.statsStartDate) return s.statsStartDate;
  var min = '';
  getEmployees_().forEach(function (e) { if (e.ActiveFrom && (!min || e.ActiveFrom < min)) min = e.ActiveFrom; });
  return min || todayStr_();
}

/** วันที่ → { CERTIFIER: record, CHECKER: record } · fresh = อ่านจากชีตใหม่ (ใช้ภายใต้ withLock_) */
function signOffsBetween_(from, to, fresh) {
  if (fresh) markDirty_('SignOffs');
  var map = {};
  readAll_('SignOffs').forEach(function (r) {
    if (r.Date < from || r.Date > to || !SIGN_ROLES[r.Role]) return;
    var d = map[r.Date] || (map[r.Date] = {});
    if (!d[r.Role]) d[r.Role] = r;
  });
  return map;
}

function signOffView_(r, ctx) {
  if (!r) return null;
  return { name: r.SignerName, position: r.SignerPosition, signedLabel: thaiStamp_(r.SignedAt), mine: !!ctx && r.EmployeeID === ctx.user.EmployeeID };
}

function normPersonName_(n) {
  return String(n || '').replace(/\s+/g, '').replace(/^(นาย|นางสาว|นาง|น\.ส\.|ดร\.|ว่าที่ร้อยตรี|ว่าที่ร\.ต\.)/, '');
}

function isDirectorUser_(user, s) {
  return !!s.directorName && normPersonName_(s.directorName) === normPersonName_(user.FullName);
}

/** ตำแหน่งที่พิมพ์ใต้ลายเซ็น (ค่าเริ่มต้น — แก้ไขได้ก่อนลงนาม) */
function defaultSignPosition_(user, role, s) {
  if (role === 'CERTIFIER' && (isDirectorUser_(user, s) || !user.Position)) return s.directorPosition || 'ผู้อำนวยการโรงเรียน';
  return user.Position || '';
}

function todayAfterWork_(s) { return timeToMin_(nowTimeStr_()) >= timeToMin_(s.workEnd); }

/** รายการวันของเดือนที่ต้องมีบัญชีลงเวลา (วันทำงาน + วันหยุดที่มีผู้มาปฏิบัติงาน) พร้อมสถานะการลงนาม */
function signOffMonth_(ctx, p) {
  var ym = parseYearMonth_(p);
  var s = ctx.settings, today = todayStr_(), start = signOffStart_();
  var from = monthStart_(ym.y, ym.m), to = monthEnd_(ym.y, ym.m);
  if (from < start) from = start;
  if (to > today) to = today;
  var afterWork = todayAfterWork_(s);
  var days = [];
  if (from <= to) {
    var res = computeAttendance_({ employees: reportEmployees_(from, to), from: from, to: to });
    var offs = signOffsBetween_(from, to);
    var counts = {};
    res.people.forEach(function (pp) {
      pp.days.forEach(function (d) {
        var c = counts[d.date] || (counts[d.date] = { total: 0, came: 0, late: 0, away: 0, absent: 0 });
        c.total++;
        if (d.checkIn) c.came++;
        if (d.status === 'LATE') c.late++;
        if (d.leave) c.away++;
        if (d.status === 'ABSENT') c.absent++;
      });
    });
    res.dates.forEach(function (date) {
      var info = res.infos[date], c = counts[date];
      if (!c || (!info.isWorkday && !c.came)) return; // วันหยุดที่ไม่มีผู้มาปฏิบัติงาน ไม่ต้องมีบัญชีลงเวลา
      var o = offs[date] || {};
      days.push({
        date: date, label: thaiDate_(date, 'short'), dayName: info.dayName, isWorkday: info.isWorkday, holidayName: info.holidayName,
        counts: c, certifier: signOffView_(o.CERTIFIER, ctx), checker: signOffView_(o.CHECKER, ctx),
        signable: date < today || afterWork
      });
    });
  }
  var director = isDirectorUser_(ctx.user, s);
  var mine = mySignatureRecord_(ctx.user.EmployeeID);
  var out = {
    year: ym.y, month: ym.m, label: thaiMonthYear_(ym.y, ym.m), startLabel: thaiDate_(start), days: days,
    hasSignature: !!mine,
    positions: { CERTIFIER: defaultSignPosition_(ctx.user, 'CERTIFIER', s), CHECKER: defaultSignPosition_(ctx.user, 'CHECKER', s) },
    defaultRole: director || (!s.directorName && ctx.user.Role === ROLES.EXECUTIVE) ? 'CERTIFIER' : 'CHECKER',
    isAdmin: ctx.user.Role === ROLES.ADMIN, workEnd: s.workEnd
  };
  if (p && p.withSignature) out.signature = signatureView_(mine);
  return out;
}

/** ลงนามหลายวันในครั้งเดียว (ย้อนหลังได้) — ข้ามวันที่ลงนามไม่ได้พร้อมบอกเหตุผล */
function certifyDays_(ctx, p) {
  p = p || {};
  var role = String(p.role || '');
  if (!SIGN_ROLES[role]) throw appError_('กรุณาเลือกว่าจะลงนามในฐานะใด', 'VALIDATION', { field: 'role' });
  var seen = {}, dates = [];
  (Array.isArray(p.dates) ? p.dates : []).forEach(function (d) {
    d = String(d || '');
    if (!isValidYmd_(d)) throw appError_('วันที่ไม่ถูกต้อง', 'VALIDATION');
    if (!seen[d]) { seen[d] = true; dates.push(d); }
  });
  if (!dates.length) throw appError_('กรุณาเลือกวันที่ต้องการลงนาม', 'VALIDATION');
  if (dates.length > SIGNOFF_MAX_DAYS_) throw appError_('ลงนามได้ครั้งละไม่เกิน ' + SIGNOFF_MAX_DAYS_ + ' วัน', 'VALIDATION');
  dates.sort();
  var s = ctx.settings;
  var position = cleanLine_(p.position, 120) || defaultSignPosition_(ctx.user, role, s);
  if (!mySignatureRecord_(ctx.user.EmployeeID)) throw appError_('กรุณาอัปโหลดลายเซ็นของท่านก่อนลงนาม', 'NO_SIGNATURE');
  var today = todayStr_(), start = signOffStart_(), afterWork = todayAfterWork_(s);
  var other = role === 'CERTIFIER' ? 'CHECKER' : 'CERTIFIER';
  var res = withLock_(function () {
    var offs = signOffsBetween_(dates[0], dates[dates.length - 1], true);
    var add = [], sk = { signed: 0, self: 0, early: 0, before: 0 }, stamp = nowStamp_();
    dates.forEach(function (d) {
      var o = offs[d] || {};
      if (d > today || (d === today && !afterWork)) sk.early++;
      else if (d < start) sk.before++;
      else if (o[role]) sk.signed++;
      else if (o[other] && o[other].EmployeeID === ctx.user.EmployeeID) sk.self++;
      else {
        add.push({ SignOffID: newId_('SGN'), Date: d, Role: role, EmployeeID: ctx.user.EmployeeID,
          SignerName: ctx.user.FullName, SignerPosition: position, SignedAt: stamp });
      }
    });
    appendRecords_('SignOffs', add);
    return { add: add, sk: sk };
  });
  var sk = res.sk, notes = [];
  if (sk.signed) notes.push('มีผู้ลงนามแล้ว ' + sk.signed + ' วัน');
  if (sk.self) notes.push('ท่านลงนามอีกบทบาทของวันนั้นแล้ว ' + sk.self + ' วัน');
  if (sk.early) notes.push('ยังไม่ถึงเวลาลงนาม (วันข้างหน้า/วันนี้ก่อนเลิกงาน) ' + sk.early + ' วัน');
  if (sk.before) notes.push('ก่อนวันเริ่มใช้ระบบ ' + sk.before + ' วัน');
  if (!res.add.length) throw appError_('ไม่มีวันที่ลงนามได้' + (notes.length ? ' (' + notes.join(', ') + ')' : ''), 'VALIDATION');
  writeAudit_(ctx, 'SIGNOFF', 'SignOffs', role, {
    role: role, position: position, dates: res.add.map(function (a) { return a.Date; }), skipped: sk
  });
  return {
    signed: res.add.length, skipped: sk,
    message: 'ลงนาม' + (role === 'CERTIFIER' ? 'รับรอง' : 'ตรวจสอบ') + 'บัญชีลงเวลาแล้ว ' + res.add.length + ' วัน' + (notes.length ? ' (ข้าม: ' + notes.join(', ') + ')' : '')
  };
}

/** ยกเลิกการลงนาม: เจ้าของการลงนาม หรือผู้ดูแลระบบ */
function revokeSignOff_(ctx, p) {
  var date = validateDateParam_(String(p && p.date || ''));
  var role = String(p && p.role || '');
  if (!SIGN_ROLES[role]) throw appError_('บทบาทการลงนามไม่ถูกต้อง', 'VALIDATION');
  var removed = withLock_(function () {
    var r = (signOffsBetween_(date, date, true)[date] || {})[role];
    if (!r) return null;
    if (r.EmployeeID !== ctx.user.EmployeeID && ctx.user.Role !== ROLES.ADMIN) throw appError_('ยกเลิกได้เฉพาะการลงนามของท่านเอง', 'FORBIDDEN');
    deleteRowNumber_('SignOffs', r._row);
    return r;
  });
  if (!removed) throw appError_('ไม่พบการลงนาม อาจถูกยกเลิกไปแล้ว', 'NOT_FOUND');
  writeAudit_(ctx, 'SIGNOFF_REVOKE', 'SignOffs', date, { role: role, signer: removed.SignerName, signedAt: removed.SignedAt });
  return { message: 'ยกเลิกการลงนามวันที่ ' + thaiDate_(date) + ' แล้ว' };
}

/* ---------- ข้อมูลสำหรับพิมพ์บัญชีลงเวลา ---------- */

/** ผู้ลงนามของแต่ละวัน + ภาพลายเซ็น (เฉพาะผู้ที่ลงนามในช่วงนั้น) */
function signOffPrintData_(from, to) {
  var offs = signOffsBetween_(from, to), need = {}, days = {};
  Object.keys(offs).forEach(function (d) {
    days[d] = {};
    Object.keys(offs[d]).forEach(function (role) {
      var r = offs[d][role];
      need[r.EmployeeID] = true;
      days[d][role] = { name: r.SignerName, position: r.SignerPosition, signedLabel: thaiStamp_(r.SignedAt), sig: r.EmployeeID };
    });
  });
  var images = {};
  if (Object.keys(need).length) {
    readAll_('Signatures').forEach(function (r) { if (need[r.EmployeeID] && r.ImageData) images[r.EmployeeID] = r.ImageData; });
  }
  return { days: days, images: images };
}

/** route sign.print: ลายเซ็นของบัญชีลงเวลาวันที่เลือก (พิมพ์จากรายงานรายวัน) */
function signBookSignatures_(ctx, p) {
  var date = validateDateParam_(String(p && p.date || ''));
  var data = signOffPrintData_(date, date);
  if (data.days[date]) writeAudit_(ctx, 'SIGNBOOK_PRINT', 'Report', date, { signed: Object.keys(data.days[date]) });
  return data;
}

function signBookHead_(date, s) {
  var dp = parseYmd_(date);
  return {
    dayName: THAI_DAYS[dayOfWeek_(date)], day: dp.d, month: THAI_MONTHS[dp.m - 1], year: dp.y + 543,
    workStart: s.workStart, lateAfter: s.lateAfter, workEnd: s.workEnd
  };
}

function signBookRow_(emp, d) {
  return {
    fullName: emp.fullName, position: emp.position,
    checkIn: d.checkIn ? d.checkIn.substr(0, 5) : '-', checkOut: d.checkOut ? d.checkOut.substr(0, 5) : '-',
    status: d.statusLabel, statusCode: d.status, lateMinutes: d.lateMinutes || '', note: d.note,
    leaveType: d.leave ? d.leave.type : '',
    leaveLabel: d.leave ? d.leave.typeLabel + (d.leave.period !== 'FULL' ? ' (' + d.leave.periodLabel + ')' : '') : ''
  };
}

/** บัญชีลงเวลาทั้งเดือน (1 หน้าต่อวัน) พร้อมผู้ลงนามและภาพลายเซ็น */
function reportSignBookMonth_(ctx, p) {
  var ym = parseYearMonth_(p);
  var today = todayStr_(), start = signOffStart_();
  var from = monthStart_(ym.y, ym.m), to = monthEnd_(ym.y, ym.m);
  if (from < start) from = start;
  if (to > today) to = today;
  if (from > to) throw appError_('ยังไม่มีบัญชีลงเวลาในเดือน' + thaiMonthYear_(ym.y, ym.m), 'VALIDATION');
  var res = computeAttendance_({ employees: reportEmployees_(from, to), from: from, to: to });
  var s = res.settings;
  var byDate = res.people.map(function (pp) {
    var m = {};
    pp.days.forEach(function (d) { m[d.date] = d; });
    return { emp: pp.emp, days: m };
  });
  var pages = [];
  res.dates.forEach(function (date) {
    var info = res.infos[date], rows = [], came = 0;
    byDate.forEach(function (x) {
      var d = x.days[date];
      if (!d) return;
      if (d.checkIn) came++;
      rows.push(signBookRow_(x.emp, d));
    });
    if (!rows.length || (!info.isWorkday && !came)) return;
    pages.push({ date: date, signBook: signBookHead_(date, s), dayInfo: { isWorkday: info.isWorkday, holidayName: info.holidayName }, rows: rows });
  });
  var sign = signOffPrintData_(from, to);
  writeAudit_(ctx, 'SIGNBOOK_PRINT', 'Report', ym.y + '-' + pad2_(ym.m), { pages: pages.length, signedDays: Object.keys(sign.days).length });
  return {
    school: APP.SCHOOL_FULL, label: thaiMonthYear_(ym.y, ym.m),
    signer: { name: s.directorName, position: s.directorPosition },
    generatedAt: thaiDate_(today) + ' เวลา ' + nowTimeStr_().substr(0, 5) + ' น.',
    pages: pages, signOffs: sign.days, images: sign.images
  };
}
