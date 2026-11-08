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
