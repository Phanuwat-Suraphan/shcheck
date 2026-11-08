/**
 * e2e-server.js — เซิร์ฟเวอร์จำลอง Web App ของ Apps Script สำหรับทดสอบ/พรีวิว UI บนเครื่อง
 *
 *   node tests/e2e-server.js            → เปิด http://localhost:8787 (ข้อมูลตัวอย่าง)
 *   FRESH=1 node tests/e2e-server.js    → จำลองการเปิดเว็บครั้งแรกหลัง Deploy (หน้าติดตั้ง)
 *   GAS_SRC=dist node tests/e2e-server.js → ใช้ชุดติดตั้งแบบง่าย 3 ไฟล์
 *
 * - เรนเดอร์ Index.html ผ่าน HtmlService จำลอง (ประมวลผล <?= ?> / include())
 * - ฉีด google.script.run shim ที่ส่งคำขอไปยัง /rpc → เรียกฟังก์ชันใน .gs จริง
 * - ผู้เยี่ยมชมเว็บเป็น "ผู้ใช้ไม่ระบุตัวตน" (Execute as: Me) เหมือนการ Deploy จริง
 */
'use strict';
const http = require('http');
const { createGasEnv } = require('./gas-mock');

const SHIM = `<script>
(function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, prop) {
      if (prop === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (prop === 'withFailureHandler') return function (f) { return runner(ok, f); };
      if (prop === 'withUserObject') return function () { return runner(ok, fail); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn: prop, args: args }) })
          .then(function (r) { return r.json(); })
          .then(function (r) { if (r.ok) { ok && ok(r.result); } else { fail && fail(new Error(r.error)); } })
          .catch(function (e) { fail && fail(e); });
      };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
})();
</script>`;

const DEFAULTS = {
  adminUser: 'admin.saohin', adminPass: 'Adm1nStrong2026', school: { lat: 18.7883, lng: 98.9853 }, now: '2026-11-09 07:50:00'
};

function createApp(opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const env = createGasEnv({ printErrors: true });
  env.state.props.PBKDF2_ITERATIONS = String(o.iterations || 20000);
  env.clock.setBkk(o.now === 'real' ? '2026-01-01 00:00:00' : o.now);
  if (o.fresh) {
    // ติดตั้งแบบง่าย: เพิ่งวางโค้ดและ Deploy — ยังไม่ได้รันอะไรเลย
    if (o.now === 'real') env.clock.fixed = null;
    env.state.activeEmail = '';
    return attachServer(env, o);
  }
  const ss = env.SpreadsheetApp.create('DB');
  env.state.activeSpreadsheetId = ss.getId();
  // เจ้าของโปรเจกต์ติดตั้งระบบจาก Editor
  env.call('SetupSystem');
  Object.assign(env.state.props, {
    BOOTSTRAP_ADMIN_USERNAME: o.adminUser, BOOTSTRAP_ADMIN_PASSWORD: o.adminPass,
    BOOTSTRAP_ADMIN_FULLNAME: 'นายผู้ดูแล ระบบโรงเรียน', BOOTSTRAP_ADMIN_STAFFCODE: 'ADM001'
  });
  env.call('CreateFirstAdmin');
  if (o.configureGeo !== false) {
    // ตั้งค่าพิกัด (เทียบเท่าการตั้งค่าจากหน้า Admin) ผ่านฟังก์ชันภายใน
    env.context.resetMemo_();
    env.context.withLock_(() => {
      const rows = env.context.readAll_('Settings');
      const set = (k, v) => { const r = rows.find(x => x.Key === k); env.context.updateRecord_('Settings', r._row, { Value: v }); };
      set('SCHOOL_LAT', String(o.school.lat)); set('SCHOOL_LNG', String(o.school.lng)); set('SETTINGS_CONFIRMED', 'TRUE');
    });
  }
  if (o.now === 'real') env.clock.fixed = null; // ใช้เวลาจริงของเครื่อง
  // จากนี้ไปคือ "ผู้ใช้ทั่วไปเปิดเว็บแอป" — ไม่ใช่เจ้าของโปรเจกต์
  env.state.activeEmail = '';
  return attachServer(env, o);
}

function attachServer(env, o) {
  const server = http.createServer((req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        const out = env.context.doGet({ parameter: {} });
        const html = out.getContent().replace('<head>', '<head>' + SHIM);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'POST' && req.url === '/rpc') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          let payload;
          try { payload = JSON.parse(body); } catch (e) { res.writeHead(400); res.end('{}'); return; }
          let out;
          try { out = { ok: true, result: env.call(payload.fn, ...(payload.args || [])) }; } catch (e) { out = { ok: false, error: String(e.message || e) }; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out === undefined ? null : out));
        });
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/__clock?')) {
        const t = decodeURIComponent(req.url.split('?')[1]);
        env.clock.setBkk(t);
        res.writeHead(200); res.end('ok');
        return;
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      console.error(e);
      res.writeHead(500); res.end(String(e));
    }
  });
  return { env, server, opts: o };
}

module.exports = { createApp, DEFAULTS };

if (require.main === module) {
  const port = +(process.env.PORT || 8787);
  const app = createApp({ now: process.env.NOW || DEFAULTS.now, fresh: process.env.FRESH === '1' });
  app.server.listen(port, () => {
    console.log('Preview server: http://localhost:' + port);
    console.log('Admin: ' + DEFAULTS.adminUser + ' / ' + DEFAULTS.adminPass + ' (ระบบจะบังคับเปลี่ยนรหัสผ่าน)');
    console.log('พิกัดโรงเรียนจำลอง: ' + DEFAULTS.school.lat + ', ' + DEFAULTS.school.lng);
  });
}
