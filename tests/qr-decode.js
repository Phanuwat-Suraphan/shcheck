/**
 * qr-decode.js — ตัวถอดรหัส QR Code แบบง่ายสำหรับทดสอบ (เขียนแยกจากตัวสร้างใน AdminScript.html)
 * ตรวจ: Finder pattern, Format info (BCH + สองตำแหน่งตรงกัน), Version info (v≥7),
 *       Reed-Solomon syndrome = 0 ทุกบล็อก แล้วอ่านข้อความโหมด Byte (UTF-8) กลับมา
 * รองรับระดับแก้ไขข้อผิดพลาด M เวอร์ชัน 1–10
 */
'use strict';

// ค่าจากตารางมาตรฐาน ISO/IEC 18004 (ระดับ M): [จำนวน codeword ทั้งหมด, จำนวนบล็อก, ECC ต่อบล็อก]
const TABLE_M = { 1: [26, 1, 10], 2: [44, 1, 16], 3: [70, 1, 26], 4: [100, 2, 18], 5: [134, 2, 24],
  6: [172, 4, 16], 7: [196, 4, 18], 8: [242, 4, 22], 9: [292, 5, 22], 10: [346, 5, 26] };
// ตำแหน่ง Alignment pattern (ตารางมาตรฐาน Annex E)
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

// GF(256) ด้วยตาราง log/antilog (poly 0x11D)
const EXP = new Array(512), LOG = new Array(256);
(function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** เศษจากการหารพหุนามบิต (ใช้ตรวจ BCH) */
function polyMod(value, valueBits, gen, genBits) {
  for (let i = valueBits - 1; i >= genBits - 1; i--) if ((value >>> i) & 1) value ^= gen << (i - (genBits - 1));
  return value;
}

function decode(m) {
  const size = m.length;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || !TABLE_M[version]) throw new Error('ขนาดไม่ถูกต้อง ' + size);
  const at = (r, c) => !!m[r][c];
  // Finder patterns
  [[0, 0], [0, size - 7], [size - 7, 0]].forEach(([r0, c0]) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      if (at(r0 + r, c0 + c) !== (ring !== 2)) throw new Error('finder pattern ผิดที่ ' + (r0 + r) + ',' + (c0 + c));
    }
  });
  // Format info: สำเนาที่ 1 (MSB ที่แถว 8 คอลัมน์ 0) และสำเนาที่ 2
  const pos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const pos2 = [];
  for (let r = size - 1; r >= size - 7; r--) pos2.push([r, 8]);
  for (let c = size - 8; c < size; c++) pos2.push([8, c]);
  const read = (ps) => ps.reduce((v, [r, c]) => (v << 1) | (at(r, c) ? 1 : 0), 0);
  const f1 = read(pos1), f2 = read(pos2);
  if (f1 !== f2) throw new Error('format info สองตำแหน่งไม่ตรงกัน');
  const fmt = f1 ^ 0x5412;
  if (polyMod(fmt, 15, 0x537, 11) !== 0) throw new Error('format info BCH ผิด');
  const ecLevel = fmt >>> 13, mask = (fmt >>> 10) & 7;
  if (ecLevel !== 0) throw new Error('ไม่ใช่ระดับ M');
  if (!at(size - 8, 8)) throw new Error('ไม่มี dark module');
  // Version info (v≥7): บล็อก 6x3 ขวาบน และ 3x6 ซ้ายล่าง (บิต 0 อยู่มุมบนซ้ายของบล็อก)
  if (version >= 7) {
    let a = 0, b = 0;
    for (let i = 17; i >= 0; i--) {
      a = (a << 1) | (at(Math.floor(i / 3), size - 11 + (i % 3)) ? 1 : 0);
      b = (b << 1) | (at(size - 11 + (i % 3), Math.floor(i / 3)) ? 1 : 0);
    }
    if (a !== b || (a >>> 12) !== version || polyMod(a, 18, 0x1F25, 13) !== 0) throw new Error('version info ผิด');
  }
  // แผนที่โมดูลคงที่ (function modules)
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r0, c0, h, w) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < size && c < size) fn[r][c] = true; };
  mark(0, 0, 9, 9); mark(0, size - 8, 9, 8); mark(size - 8, 0, 8, 9);
  mark(6, 0, 1, size); mark(0, 6, size, 1);
  const al = ALIGN[version];
  const inFinder = (r, c) => (r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9);
  al.forEach(r => al.forEach(c => { if (!inFinder(r, c)) mark(r - 2, c - 2, 5, 5); }));
  if (version >= 7) { mark(0, size - 11, 6, 3); mark(size - 11, 0, 3, 6); }
  const maskFn = [
    (i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
    (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0, (i, j) => ((i + j) % 2 + (i * j) % 3) % 2 === 0
  ][mask];
  // อ่านบิตแบบซิกแซกจากมุมขวาล่าง
  const bits = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let k = 0; k < size; k++) {
      const r = upward ? size - 1 - k : k;
      for (const c of [col, col - 1]) if (!fn[r][c]) bits.push((at(r, c) !== maskFn(r, c)) ? 1 : 0);
    }
    upward = !upward;
  }
  const [total, nb, ecc] = TABLE_M[version];
  const cws = [];
  for (let i = 0; i + 8 <= bits.length && cws.length < total; i += 8) cws.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  if (cws.length !== total) throw new Error('จำนวน codeword ไม่ครบ ' + cws.length + '/' + total);
  // แยกบล็อก (deinterleave)
  const dataTotal = total - nb * ecc, shortData = Math.floor(dataTotal / nb), nLong = dataTotal % nb;
  const blocks = Array.from({ length: nb }, (_, i) => ({ data: [], ecc: [], dataLen: shortData + (i >= nb - nLong ? 1 : 0) }));
  let p = 0;
  for (let i = 0; i < shortData + 1; i++) blocks.forEach(b => { if (i < b.dataLen) b.data.push(cws[p++]); });
  for (let i = 0; i < ecc; i++) blocks.forEach(b => b.ecc.push(cws[p++]));
  // Reed-Solomon: syndrome S_k = c(α^k) ต้องเป็น 0 ทุก k (k = 0..ecc-1)
  blocks.forEach((b, bi) => {
    const word = b.data.concat(b.ecc);
    for (let k = 0; k < ecc; k++) {
      let s = 0;
      for (const v of word) s = gmul(s, EXP[k]) ^ v;
      if (s !== 0) throw new Error('Reed-Solomon ผิดที่บล็อก ' + bi + ' syndrome ' + k);
    }
  });
  // อ่านข้อมูลโหมด Byte
  const dbits = [];
  const data = [].concat(...blocks.map(b => b.data));
  data.forEach(v => { for (let i = 7; i >= 0; i--) dbits.push((v >>> i) & 1); });
  let q = 0;
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | dbits[q++]; return v; };
  if (take(4) !== 4) throw new Error('ไม่ใช่โหมด Byte');
  const len = take(version < 10 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return { version, mask, text: Buffer.from(bytes).toString('utf8') };
}

module.exports = { decode };
