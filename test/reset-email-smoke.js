'use strict';
/* "Forgot password?" e-mail path smoke test. A stub SMTP server answers slowly and then refuses
   (554), so the real server takes its e-mail branch, waits on SMTP and falls back to flagging the
   managers — no real mail server or TLS certificate needed. Checks that the "Reset requested" flag
   survives another request reloading the DB during the SMTP wait, that the per-account cooldown then
   holds, and that with e-mail on every answer is held to the same minimum time. Run via `npm test`. */
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gqa-reset-mail-'));
const SMTP_PORT = 34591, APP_PORT = 34592;
const SMTP_DELAY_MS = 1500;  // well inside the server's padding, like a normal relay
const FORGOT_MIN_MS = 3000;  // mirrors FORGOT_MIN_MS in server.js
const ADMIN_EMAIL = 'admin@golden.test';

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (extra ? '  -> ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let smtpConns = 0;
const smtp = net.createServer((sock) => {
  smtpConns++; sock.on('error', () => {});
  const t = setTimeout(() => { try { sock.end('554 5.3.2 test stub: no mail service\r\n'); } catch (e) {} }, SMTP_DELAY_MS);
  sock.on('close', () => clearTimeout(t));
});

function rq(method, p, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null, t0 = Date.now();
    const r = http.request({ host: '127.0.0.1', port: APP_PORT, path: p, method, timeout: 20000, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'x-token': token } : {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: d, ms: Date.now() - t0 }); });
    });
    r.on('error', () => resolve({ status: 0, body: {}, raw: '', ms: Date.now() - t0 }));
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (data) r.write(data); r.end();
  });
}

smtp.listen(SMTP_PORT, '127.0.0.1', async () => {
  const app = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(APP_PORT), HOST: '127.0.0.1', GQA_DATA_DIR: DATA_DIR, DATABASE_URL: '', NODE_ENV: '', LDAP_ENABLED: '',
      ADMIN_PASSWORD: 'BreakGlass123', ADMIN_EMAIL,
      SMTP_ENABLED: 'true', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_SECURE: 'false',
      APP_URL: 'https://qa.golden.test',
    }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  app.stderr.on('data', d => console.log('APP-ERR: ' + String(d).trim()));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { const h = await rq('GET', '/api/health'); up = h.status === 200; if (!up) await sleep(200); }

  try {
    ok('server is up', up);
    let r = await rq('GET', '/api/config');
    ok('config: passwordReset.email is true (SMTP + APP_URL)', !!(r.body.passwordReset && r.body.passwordReset.email === true), JSON.stringify(r.body.passwordReset));
    r = await rq('POST', '/api/login', { username: 'admin', password: 'BreakGlass123' });
    const adminTok = r.body.token; // signed in BEFORE asking: a password sign-in withdraws a pending request
    ok('admin signs in', r.status === 200 && !!adminTok, r.status + ' ' + JSON.stringify(r.body));
    await sleep(SMTP_DELAY_MS + 500); // let boot-time reminder e-mails (if any) reach the stub first

    // the e-mail attempt fails after a delay; meanwhile another request reloads the DB document
    let c0 = smtpConns;
    const pending = rq('POST', '/api/password/forgot', { identifier: ADMIN_EMAIL });
    await sleep(300);
    await rq('GET', '/api/me'); // 401, but every /api request reloads the global DB first
    const fReal = await pending;
    ok('forgot (real account with e-mail) -> 200 {ok:true}', fReal.status === 200 && fReal.body.ok === true, fReal.status + ' ' + fReal.raw);
    ok('forgot tried to e-mail the link (stub SMTP contacted)', smtpConns > c0, 'connections ' + c0 + ' -> ' + smtpConns);
    r = await rq('GET', '/api/admin/users', null, adminTok);
    const row = (Array.isArray(r.body) ? r.body : []).find(u => u.id === 'admin') || {};
    ok('Reset requested flag survives a DB reload during the SMTP wait', !!row.resetRequested, JSON.stringify(row));

    // repeat inside the cooldown: no second e-mail attempt
    c0 = smtpConns;
    const fRepeat = await rq('POST', '/api/password/forgot', { identifier: 'admin' });
    await sleep(300);
    ok('repeat forgot -> same 200 body', fRepeat.status === 200 && fRepeat.raw === fReal.raw, fRepeat.status + ' ' + fRepeat.raw);
    ok('repeat inside the cooldown does not e-mail again', smtpConns === c0, 'connections ' + c0 + ' -> ' + smtpConns);

    // timing: an unknown id waits as long as a real account that was e-mailed
    const fGhost = await rq('POST', '/api/password/forgot', { identifier: 'ghost' + process.pid });
    ok('forgot (unknown id) -> same 200 body', fGhost.status === 200 && fGhost.raw === fReal.raw, fGhost.status + ' ' + fGhost.raw);
    ok('with e-mail on, every forgot answer takes at least the padded minimum',
      [fReal, fRepeat, fGhost].every(x => x.ms >= FORGOT_MIN_MS - 50), [fReal.ms, fRepeat.ms, fGhost.ms].join(' / ') + ' ms');
    ok('real (e-mailed) and unknown-id answers take about the same time', Math.abs(fReal.ms - fGhost.ms) < 750, fReal.ms + ' vs ' + fGhost.ms + ' ms');

    r = await rq('GET', '/api/audit?action=reset&limit=500', null, adminTok);
    const aud = (Array.isArray(r.body) ? r.body : []).map(e => e.action + ':' + e.detail);
    ok('audit: failed e-mail fell back to "(admin notified)"', aud.includes('password-reset-request:admin (admin notified)'), JSON.stringify(aud));
    ok('audit: repeat logged as within cooldown', aud.includes('password-reset-request:admin (repeat request within cooldown)'), JSON.stringify(aud));

    // admin-issued link with e-mail: SMTP refuses -> a clear 502, no token handed out by e-mail
    r = await rq('POST', '/api/admin/users/admin/reset-link', { email: true }, adminTok);
    ok('reset-link {email:true} with SMTP failing -> 502 with a reason', r.status === 502 && /Could not send/.test(r.body.error || ''), r.status + ' ' + JSON.stringify(r.body));
    r = await rq('GET', '/api/audit/verify', null, adminTok);
    ok('audit chain intact', r.body && r.body.ok === true, JSON.stringify(r.body));
  } catch (e) { console.log('TEST ERROR:', e && e.stack ? e.stack : e); fail++; }

  console.log('\nReset e-mail smoke summary: ' + pass + ' passed, ' + fail + ' failed');
  try { app.kill('SIGKILL'); } catch (e) {}
  smtp.close();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
});
