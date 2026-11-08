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
  if (!AUTH_.STAFFCODE_RE.test(staffCode)) {
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
    var data = validateEmployeeInput_(form, { requirePassword: true });
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
    var st = getLoginState_(uname);
    if (st.lockedUntil && st.lockedUntil > nowMs_()) {
      var mins = Math.ceil((st.lockedUntil - nowMs_()) / 60000);
      throw appError_('บัญชีถูกล็อกชั่วคราวเนื่องจากใส่รหัสผ่านผิดเกินกำหนด กรุณาลองใหม่ในอีก ' + mins +
        ' นาที หรือติดต่อผู้ดูแลระบบ', 'LOCKED');
    }
    var emp = findOne_('Employees', 'Username', uname);
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
    var token = createSession_(emp, clientInfo);
    writeAudit_({ user: emp }, 'LOGIN', 'Employee', emp.EmployeeID, { rehashed: !!newHash });
    return {
      ok: true,
      data: {
        token: token,
        user: publicUser_(emp),
        mustChangePassword: !!emp.MustChangePassword,
        sessionTimeoutMin: s.sessionTimeoutMin
      }
    };
  } catch (err) {
    return toErrorResponse_(err, 'login');
  }
}

/* ========================================================================== */
/*  Sessions                                                                  */
/* ========================================================================== */

function sessionKey_(token) { return 'sess_' + sha256Hex_('session:' + token); }

function createSession_(emp, clientInfo) {
  var s = getSettings_();
  var token = randomHex_(32);
  var key = sessionKey_(token);
  var sess = { uid: emp.EmployeeID, sv: Number(emp.SessionVersion) || 0, iat: nowMs_(), ref: key.substr(5, 16) };
  CacheService.getScriptCache().put(key, JSON.stringify(sess), s.sessionTimeoutMin * 60);
  var ua = clientInfo && typeof clientInfo === 'object' ? cleanLine_(clientInfo.ua, 250) : '';
  appendRecord_('Sessions', {
    SessionRef: sess.ref, EmployeeID: emp.EmployeeID, Username: emp.Username,
    LoginAt: nowStamp_(), LogoutAt: '', EndReason: '', UserAgent: ua
  });
  return token;
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
 *   BOOTSTRAP_ADMIN_STAFFCODE  (จำเป็น)
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
  if (!input.username || !input.password || !input.fullName || !input.staffCode) {
    throw new Error('กรุณาตั้งค่า Script Properties: BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD, ' +
      'BOOTSTRAP_ADMIN_FULLNAME, BOOTSTRAP_ADMIN_STAFFCODE ก่อนรันฟังก์ชันนี้');
  }
  var data;
  try {
    data = validateEmployeeInput_(input, { requirePassword: true });
  } catch (e) {
    throw new Error('ข้อมูลผู้ดูแลระบบไม่ถูกต้อง: ' + e.message);
  }
  var hash = hashPassword_(data.password);
  var rec = withLock_(function () {
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
  writeAudit_(null, 'BOOTSTRAP_ADMIN_CREATED', 'Employee', rec.EmployeeID, { username: rec.Username });
  var msg = '✔ สร้างผู้ดูแลระบบ "' + rec.Username + '" เรียบร้อย\n' +
    '✔ ลบ BOOTSTRAP_ADMIN_PASSWORD ออกจาก Script Properties แล้ว\n' +
    '➜ เข้าสู่ระบบผ่านเว็บแอปด้วยรหัสผ่านที่ตั้งไว้ ระบบจะบังคับให้เปลี่ยนรหัสผ่านทันที';
  Logger.log(msg);
  return msg;
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
