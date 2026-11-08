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
      if (!summary || !summary.CheckInTime) {
        throw appError_('ยังไม่มีการลงเวลาเข้างานของวันนี้ กรุณาลงเวลาเข้างานก่อน (หากลืมลงเวลาเข้า ให้ยื่นคำร้องแก้ไขเวลา)', 'NO_CHECKIN');
      }
      if (summary.CheckOutTime) {
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
    pending: { leaves: myLeaves, corrections: myCorr }
  };
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
