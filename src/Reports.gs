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
  return {
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
      note: d.note, inMaps: d.inMaps || null, outMaps: d.outMaps || null, employeeId: pp.emp.employeeId
    });
  });
  rep.dayInfo = { isWorkday: info ? info.isWorkday : true, holidayName: info ? info.holidayName : '' };
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

function buildReportByType_(ctx, type, params) {
  if (type === 'daily') return reportDaily_(ctx, params || {});
  if (type === 'monthly') return reportMonthly_(ctx, params || {});
  if (type === 'yearly') return reportYearly_(ctx, params || {});
  if (type === 'individual') return reportIndividual_(ctx, params || {});
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
  pushRow([txt('ลงชื่อ ......................................................... ผู้อำนวยการโรงเรียน')], 'sign');
  pushRow([txt('( ......................................................... )')], 'sign');

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
