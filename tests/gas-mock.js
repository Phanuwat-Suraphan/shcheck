/**
 * gas-mock.js — Google Apps Script runtime simulator for local testing (Node.js)
 *
 * Emulates the subset of Apps Script services used by the project:
 * SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities,
 * Session, HtmlService, DriveApp, ScriptApp, UrlFetchApp, Logger.
 *
 * Spreadsheet writes follow Google Sheets input rules so that bugs surface:
 *  - "'text"          → stored as literal text (apostrophe removed)
 *  - "=..."           → treated as a formula → the mock THROWS (formula injection guard)
 *  - "00123", "2026-11-08", "08:30" in non-text cells → auto-converted to Number/Date
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class Clock {
  constructor() { this.fixed = null; }
  now() { return this.fixed !== null ? this.fixed : Date.now(); }
  /** set Bangkok local time, e.g. clock.setBkk('2026-11-09 08:15:00') */
  setBkk(s) { this.fixed = new Date(s.replace(' ', 'T') + '+07:00').getTime(); }
  advanceMinutes(n) { this.fixed = this.now() + n * 60000; }
}

function toSigned(b) { return b > 127 ? b - 256 : b; }

function formatDate(date, tz, pattern) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  return pattern.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, t => ({
    yyyy: parts.year, yy: parts.year.slice(-2), MM: parts.month, dd: parts.day,
    HH: parts.hour, mm: parts.minute, ss: parts.second
  })[t]);
}

/** Wrap object so that unknown (styling) methods become chainable no-ops */
function chainable(target, unknownLog) {
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop in t) {
        const v = t[prop];
        return typeof v === 'function' ? v.bind(t) : v;
      }
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
      unknownLog.add(t.constructor.name + '.' + String(prop));
      return () => proxy;
    }
  });
  return proxy;
}

function createGasEnv(opts = {}) {
  // GAS_SRC=dist → ทดสอบชุดติดตั้งแบบง่าย (3 ไฟล์) แทนโค้ดแยกไฟล์ใน src/
  const srcDir = opts.srcDir || path.join(__dirname, '..', process.env.GAS_SRC || 'src');
  const clock = opts.clock || new Clock();
  const unknown = new Set();
  const state = {
    props: {}, cache: new Map(), spreadsheets: new Map(), driveFiles: new Map(), driveFolders: new Map(),
    triggers: [], activeEmail: 'owner@example.com', effectiveEmail: 'owner@example.com',
    activeSpreadsheetId: null, fetchLog: [], lockBusy: false, logs: []
  };

  /* ------------------------------ Spreadsheet ------------------------------ */
  let sheetSeq = 100;
  function convertInput(v, isText) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return new Date(v.getTime());
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    const s = String(v);
    // แบบจำลองกรณีเลวร้าย: เซลล์ Plain Text (@) อาจเก็บเครื่องหมาย ' ไว้ด้วย → ฝั่งอ่านต้องรองรับ
    if (s.startsWith("'")) return isText ? s : s.slice(1);
    if (s.startsWith('=')) throw new Error('FORMULA WRITE BLOCKED BY MOCK: ' + s.slice(0, 60));
    if (isText || s === '') return s;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (/^(TRUE|FALSE)$/i.test(s)) return s.toUpperCase() === 'TRUE';
    if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) return new Date(s.replace(' ', 'T') + '+07:00');
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return new Date('1899-12-30T' + s.padStart(8, '0').slice(0, 8) + '+07:00');
    return s;
  }

  class MockRange {
    constructor(sheet, r, c, nr, nc) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`Invalid range ${r},${c},${nr},${nc}`);
      Object.assign(this, { sheet, r, c, nr, nc });
    }
    getRow() { return this.r; }
    getColumn() { return this.c; }
    getNumRows() { return this.nr; }
    getNumColumns() { return this.nc; }
    getLastRow() { return this.r + this.nr - 1; }
    getA1Notation() { return `R${this.r}C${this.c}:R${this.r + this.nr - 1}C${this.c + this.nc - 1}`; }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) {
          const v = this.sheet.cell(this.r + i, this.c + j);
          row.push(v instanceof Date ? new Date(v.getTime()) : v);
        }
        out.push(row);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(values) {
      if (!Array.isArray(values) || values.length !== this.nr) throw new Error(`setValues rows mismatch: ${values && values.length} vs ${this.nr}`);
      values.forEach((row, i) => {
        if (row.length !== this.nc) throw new Error(`setValues cols mismatch: ${row.length} vs ${this.nc}`);
        row.forEach((v, j) => this.sheet.write(this.r + i, this.c + j, v));
      });
      return chainable(this, unknown);
    }
    setValue(v) { this.sheet.write(this.r, this.c, v); return chainable(this, unknown); }
    setNumberFormat(f) {
      for (let j = 0; j < this.nc; j++) this.sheet.colFormat[this.c + j] = f;
      return chainable(this, unknown);
    }
    clearContent() {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.write(this.r + i, this.c + j, '');
      return chainable(this, unknown);
    }
    merge() { this.sheet.merges.push(this.getA1Notation()); return chainable(this, unknown); }
    setNotes(n) { this.sheet.notes = n; return chainable(this, unknown); }
    createTextFinder(text) {
      const range = this;
      const f = { entire: false, matchCase: false };
      const finder = {
        matchEntireCell(b) { f.entire = b; return finder; },
        matchCase(b) { f.matchCase = b; return finder; },
        useRegularExpression() { return finder; },
        matchFormulaText() { return finder; },
        findAll() {
          const hits = [];
          for (let i = 0; i < range.nr; i++) for (let j = 0; j < range.nc; j++) {
            let v = range.sheet.cell(range.r + i, range.c + j);
            v = v instanceof Date ? formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd') : String(v);
            let a = v, b = String(text);
            if (!f.matchCase) { a = a.toLowerCase(); b = b.toLowerCase(); }
            if (f.entire ? a === b : a.indexOf(b) >= 0) hits.push(chainable(new MockRange(range.sheet, range.r + i, range.c + j, 1, 1), unknown));
          }
          return hits;
        },
        findNext() { return finder.findAll()[0] || null; }
      };
      return finder;
    }
  }

  class MockSheet {
    constructor(ss, name) {
      Object.assign(this, { ss, name, rows: [], colFormat: {}, maxRows: 1000, maxCols: 26, id: sheetSeq++, merges: [], notes: null, frozen: 0 });
    }
    cell(r, c) { const row = this.rows[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
    write(r, c, v) {
      if (r > this.maxRows || c > this.maxCols) throw new Error(`Write outside grid (${r},${c}) max ${this.maxRows}x${this.maxCols} in ${this.name}`);
      while (this.rows.length < r) this.rows.push([]);
      const row = this.rows[r - 1];
      while (row.length < c) row.push('');
      row[c - 1] = convertInput(v, this.colFormat[c] === '@' && r > 1);
    }
    getName() { return this.name; }
    setName(n) { this.name = n; return chainable(this, unknown); }
    getSheetId() { return this.id; }
    getParent() { return this.ss; }
    getLastRow() {
      for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some(v => v !== '' && v !== null)) return i + 1;
      return 0;
    }
    getLastColumn() {
      let m = 0;
      this.rows.forEach(r => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== null) { m = Math.max(m, j + 1); break; } });
      return m;
    }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    insertRowsAfter(after, n) { this.maxRows += n; return chainable(this, unknown); }
    insertColumnsAfter(after, n) { this.maxCols += n; return chainable(this, unknown); }
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') throw new Error('A1 notation not supported in mock');
      return chainable(new MockRange(this, r, c, nr || 1, nc || 1), unknown);
    }
    getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(arr) {
      const r = this.getLastRow() + 1;
      if (r > this.maxRows) this.maxRows = r;
      if (arr.length > this.maxCols) this.maxCols = arr.length;
      arr.forEach((v, j) => this.write(r, j + 1, v));
      return chainable(this, unknown);
    }
    deleteRow(r) { this.rows.splice(r - 1, 1); this.maxRows--; return chainable(this, unknown); }
    clear() { this.rows = []; return chainable(this, unknown); }
    setFrozenRows(n) { this.frozen = n; return chainable(this, unknown); }
    protect() { return chainable({ constructor: { name: 'Protection' } }, unknown); }
    /** test helper: rows as objects */
    _records() {
      const head = this.rows[0] || [];
      return this.rows.slice(1).filter(r => r.some(v => v !== '')).map(r => {
        const o = {}; head.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; }); return o;
      });
    }
  }

  class MockSpreadsheet {
    constructor(name) {
      this.id = 'SS_' + crypto.randomBytes(8).toString('hex');
      this.name = name; this.sheets = []; this.tz = 'Etc/UTC';
      const first = new MockSheet(this, 'Sheet1');
      this.sheets.push(first);
      state.spreadsheets.set(this.id, this);
      state.driveFiles.set(this.id, new MockFile(this.id, name, 'application/vnd.google-apps.spreadsheet', Buffer.from('')));
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheets() { return this.sheets.map(s => chainable(s, unknown)); }
    getSheetByName(n) { const s = this.sheets.find(x => x.name === n); return s ? chainable(s, unknown) : null; }
    insertSheet(n) {
      if (this.sheets.find(x => x.name === n)) throw new Error('Sheet exists: ' + n);
      const s = new MockSheet(this, n); this.sheets.push(s); return chainable(s, unknown);
    }
    deleteSheet(sh) { this.sheets = this.sheets.filter(s => s.name !== sh.getName()); }
    setSpreadsheetTimeZone(tz) { this.tz = tz; }
    getSpreadsheetTimeZone() { return this.tz; }
  }

  const SpreadsheetApp = {
    create(name) { return chainable(new MockSpreadsheet(name), unknown); },
    openById(id) {
      const ss = state.spreadsheets.get(id);
      if (!ss) throw new Error('Spreadsheet not found: ' + id);
      return chainable(ss, unknown);
    },
    getActiveSpreadsheet() {
      return state.activeSpreadsheetId ? SpreadsheetApp.openById(state.activeSpreadsheetId) : null;
    },
    flush() { state.flushes = (state.flushes || 0) + 1; },
    BorderStyle: { SOLID: 'SOLID' }
  };

  /* ------------------------------ Drive ------------------------------ */
  class MockFile {
    constructor(id, name, mime, bytes) {
      Object.assign(this, { id, name, mime, bytes: Buffer.from(bytes), trashed: false, created: new Date(clock.now()), parent: null });
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getMimeType() { return this.mime; }
    getSize() { return this.bytes.length; }
    getBlob() { return new MockBlob([...this.bytes].map(toSigned), this.mime, this.name); }
    setTrashed(b) { this.trashed = !!b; return this; }
    isTrashed() { return this.trashed; }
    moveTo(folder) { this.parent = folder.getId(); return this; }
    getDateCreated() { return new Date(this.created.getTime()); }
  }
  class MockFolder {
    constructor(name) { this.id = 'FOLDER_' + crypto.randomBytes(6).toString('hex'); this.name = name; this.trashed = false; state.driveFolders.set(this.id, this); }
    getId() { return this.id; }
    getName() { return this.name; }
    isTrashed() { return this.trashed; }
    createFolder(n) { const f = new MockFolder(n); f.parent = this.id; return f; }
    createFile(blob) {
      const f = new MockFile('FILE_' + crypto.randomBytes(8).toString('hex'), blob.getName(), blob.getContentType(), Buffer.from(blob.getBytes().map(b => b & 255)));
      f.parent = this.id; state.driveFiles.set(f.id, f); return f;
    }
    getFiles() {
      const files = [...state.driveFiles.values()].filter(f => f.parent === this.id && !f.trashed);
      let i = 0;
      return { hasNext: () => i < files.length, next: () => files[i++] };
    }
  }
  const DriveApp = {
    getStorageUsed() { return state.storageUsed !== undefined ? state.storageUsed : 2 * 1024 ** 3; },
    getStorageLimit() { return state.storageLimit !== undefined ? state.storageLimit : 15 * 1024 ** 3; },
    createFolder(n) { return new MockFolder(n); },
    getFolderById(id) { const f = state.driveFolders.get(id); if (!f) throw new Error('Folder not found'); return f; },
    getFileById(id) { const f = state.driveFiles.get(id); if (!f) throw new Error('File not found: ' + id); return f; }
  };

  /* ------------------------------ Blob / Utilities ------------------------------ */
  class MockBlob {
    constructor(data, mime, name) {
      if (typeof data === 'string') this.bytes = Buffer.from(data, 'utf8');
      else this.bytes = Buffer.from(data.map(b => b & 255));
      this.mime = mime || 'application/octet-stream'; this.name = name || 'blob';
    }
    getBytes() { return [...this.bytes].map(toSigned); }
    getDataAsString() { return this.bytes.toString('utf8'); }
    getContentType() { return this.mime; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
  }
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest(alg, value) {
      const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.map(b => b & 255));
      return [...crypto.createHash(alg).update(buf).digest()].map(toSigned);
    },
    base64Encode(v) {
      const buf = typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => b & 255));
      return buf.toString('base64');
    },
    base64Decode(s) {
      if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error('Invalid base64');
      return [...Buffer.from(s, 'base64')].map(toSigned);
    },
    getUuid() { return crypto.randomUUID(); },
    formatDate,
    newBlob(data, mime, name) { return new MockBlob(data, mime, name); },
    sleep() {}
  };

  /* ------------------------------ Properties / Cache / Lock ------------------------------ */
  const scriptProps = {
    getProperty(k) { return Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : null; },
    setProperty(k, v) {
      if (typeof v !== 'string') throw new Error('Property value must be string: ' + k);
      if (v.length > 9000) throw new Error('Property too large');
      state.props[k] = v; return scriptProps;
    },
    setProperties(o) { Object.keys(o).forEach(k => scriptProps.setProperty(k, String(o[k]))); return scriptProps; },
    deleteProperty(k) { delete state.props[k]; return scriptProps; },
    getProperties() { return Object.assign({}, state.props); },
    getKeys() { return Object.keys(state.props); }
  };
  const PropertiesService = { getScriptProperties: () => scriptProps };

  const scriptCache = {
    get(k) {
      const e = state.cache.get(k);
      if (!e) return null;
      if (e.exp <= clock.now()) { state.cache.delete(k); return null; }
      return e.v;
    },
    put(k, v, ttl) {
      if (typeof v !== 'string') throw new Error('Cache value must be string');
      if (k.length > 250) throw new Error('Cache key too long');
      if (Buffer.byteLength(v) > 100 * 1024) throw new Error('Cache value too large');
      const t = Math.min(ttl === undefined ? 600 : ttl, 21600);
      state.cache.set(k, { v, exp: clock.now() + t * 1000 });
    },
    remove(k) { state.cache.delete(k); },
    getAll(keys) { const o = {}; keys.forEach(k => { const v = scriptCache.get(k); if (v !== null) o[k] = v; }); return o; },
    putAll(o, ttl) { Object.keys(o).forEach(k => scriptCache.put(k, o[k], ttl)); },
    removeAll(keys) { keys.forEach(k => state.cache.delete(k)); }
  };
  const CacheService = { getScriptCache: () => scriptCache };

  const lock = {
    held: false,
    tryLock() { if (state.lockBusy) return false; this.held = true; return true; },
    waitLock() { if (state.lockBusy) throw new Error('Lock timeout'); this.held = true; },
    releaseLock() { this.held = false; },
    hasLock() { return this.held; }
  };
  const LockService = { getScriptLock: () => lock };

  /* ------------------------------ Session / Script / Fetch ------------------------------ */
  const Session = {
    getActiveUser: () => ({ getEmail: () => state.activeEmail }),
    getEffectiveUser: () => ({ getEmail: () => state.effectiveEmail }),
    getScriptTimeZone: () => 'Asia/Bangkok'
  };
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.map(t => ({ getHandlerFunction: () => t.fn })),
    newTrigger(fn) {
      const t = { fn };
      const b = { timeBased: () => b, atHour: h => { t.hour = h; return b; }, everyDays: n => { t.days = n; return b; }, inTimezone: z => { t.tz = z; return b; }, create: () => { state.triggers.push(t); return t; } };
      return b;
    },
    getOAuthToken: () => 'mock-oauth-token',
    getService: () => ({ getUrl: () => state.serviceUrl || 'https://script.google.com/macros/s/AKfycbyTEST0000000000000000000000000000000000000000000000000000000000/exec' })
  };
  const UrlFetchApp = {
    fetch(url, options) {
      state.fetchLog.push({ url, options });
      const m = /docs\.google\.com\/spreadsheets\/d\/([^/]+)\/export\?(.*)$/.exec(url);
      if (!m) throw new Error('Unexpected fetch: ' + url);
      const ss = state.spreadsheets.get(m[1]);
      const file = state.driveFiles.get(m[1]);
      if (!ss || (file && file.trashed)) return { getResponseCode: () => 404, getBlob: () => new MockBlob('', 'text/plain'), getContentText: () => 'nf' };
      const isPdf = /format=pdf/.test(m[2]);
      const dump = JSON.stringify(ss.sheets.map(s => ({ name: s.name, rows: s.rows })));
      const body = (isPdf ? '%PDF-1.4\n' : 'PK\u0003\u0004') + dump;
      return { getResponseCode: () => 200, getBlob: () => new MockBlob(body, isPdf ? 'application/pdf' : 'application/zip'), getContentText: () => body };
    }
  };

  /* ------------------------------ HtmlService ------------------------------ */
  function readHtml(name) { return fs.readFileSync(path.join(srcDir, name + '.html'), 'utf8'); }
  class HtmlOutput {
    constructor(content) { this.content = content; this.meta = {}; this.title = ''; this.xframe = null; }
    getContent() { return this.content; }
    setTitle(t) { this.title = t; return this; }
    getTitle() { return this.title; }
    addMetaTag(n, c) { this.meta[n] = c; return this; }
    setXFrameOptionsMode(m) { this.xframe = m; return this; }
    setSandboxMode() { return this; }
    setFaviconUrl() { return this; }
  }
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function compileTemplate(src) {
    let code = 'var __out = [];\n';
    const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      code += '__out.push(' + JSON.stringify(src.slice(last, m.index)) + ');\n';
      const expr = m[2].trim().replace(/;+\s*$/, '');
      if (m[1] === '!=') code += '__out.push(String(' + expr + '));\n';
      else if (m[1] === '=') code += '__out.push(__esc(String(' + expr + ')));\n';
      else code += m[2] + '\n';
      last = re.lastIndex;
    }
    code += '__out.push(' + JSON.stringify(src.slice(last)) + ');\nreturn __out.join("");';
    return code;
  }
  const HtmlService = {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
    SandboxMode: { IFRAME: 'IFRAME' },
    createHtmlOutputFromFile(name) { return new HtmlOutput(readHtml(name)); },
    createHtmlOutput(c) { return new HtmlOutput(c || ''); },
    createTemplateFromFile(name) {
      const src = readHtml(name);
      const tpl = {
        evaluate() {
          const vars = {};
          Object.keys(tpl).forEach(k => { if (k !== 'evaluate') vars[k] = tpl[k]; });
          const fn = vm.runInContext('(function(__vars, __esc){ with(__vars){ ' + compileTemplate(src) + ' } })', context);
          return new HtmlOutput(fn(vars, escHtml));
        }
      };
      return tpl;
    }
  };

  const Logger = { log: (...a) => { state.logs.push(a.join(' ')); } };
  const quietConsole = {
    log: (...a) => state.logs.push(a.join(' ')),
    info: (...a) => state.logs.push(a.join(' ')),
    warn: (...a) => state.logs.push('WARN ' + a.join(' ')),
    error: (...a) => { state.logs.push('ERROR ' + a.join(' ')); if (opts.printErrors) console.error(...a); }
  };

  const context = vm.createContext({
    console: quietConsole, Logger, SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities,
    Session, HtmlService, DriveApp, ScriptApp, UrlFetchApp,
    // ใช้ Date ของ Node ร่วมกัน เพื่อให้ instanceof Date ทำงานข้าม realm ได้เหมือน Apps Script
    Date, Intl
  });
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs')).sort();
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), context, { filename: f }));
  // ควบคุมเวลา "ปัจจุบัน" ของ Server ผ่าน clock
  context.now_ = () => new Date(clock.now());

  /** Emulate google.script.run: args/return values are serialized; Dates in return values are not allowed */
  function call(fnName, ...args) {
    if (typeof context[fnName] !== 'function') throw new Error('No such function: ' + fnName);
    if (fnName.endsWith('_')) throw new Error('Private function cannot be called from client: ' + fnName);
    const cleanArgs = JSON.parse(JSON.stringify(args));
    const res = context[fnName](...cleanArgs);
    assertSerializable(res, fnName);
    return res === undefined ? undefined : JSON.parse(JSON.stringify(res));
  }
  function assertSerializable(v, where, p = '$') {
    if (v instanceof Date) throw new Error(`Date object in return value of ${where} at ${p} (google.script.run would return null)`);
    if (typeof v === 'function') throw new Error(`Function in return value of ${where} at ${p}`);
    if (v && typeof v === 'object') Object.keys(v).forEach(k => assertSerializable(v[k], where, p + '.' + k));
  }

  return { context, state, clock, call, unknown, SpreadsheetApp, Clock };
}

module.exports = { createGasEnv, Clock, formatDate };
