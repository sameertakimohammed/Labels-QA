'use strict';
/* Resend transport smoke test. A stub of Resend's POST /emails endpoint (RESEND_API_URL) records
   every call, so the real server sends "Forgot password?" and admin reset-link e-mails through the
   Resend path end to end — no network or real API key needed. Checks the request shape (auth header,
   from/to, link built from APP_URL), that the e-mailed link really resets the password, that a
   Resend error surfaces as a 502 with Resend's message, and that the API key never leaks into a
   response or the audit log. Then, run the way Vercel runs it (api/index.js behind a plain HTTP
   server, no long-running timers), that a background alert (job hold) is answered by Resend before
   the response goes out, since a serverless function is frozen once it has answered. Run via `npm test`. */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gqa-resend-'));
const DATA_DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gqa-resend-sv-'));
const STUB_PORT = 34593, APP_PORT = 34594;
const API_KEY = 're_test_' + process.pid + '_secret';
const FROM = 'Golden QA <qa@golden.test>';
const ADMIN_EMAIL = 'admin@golden.test';

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (extra ? '  -> ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const calls = []; let refuseNext = false, replyDelayMs = 0;
const stub = http.createServer((req, res) => {
  let d = ''; req.on('data', c => d += c);
  req.on('end', () => {
    let body = {}; try { body = JSON.parse(d); } catch (e) {}
    const call = { method: req.method, url: req.url, auth: req.headers['authorization'] || '', body, replied: false };
    calls.push(call);
    const refuse = refuseNext; refuseNext = false;
    const reply = () => {
      call.replied = true;
      if (refuse) { res.writeHead(422, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ name: 'validation_error', message: 'The gml.com.fj domain is not verified.' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'stub-' + calls.length }));
    };
    if (replyDelayMs) setTimeout(reply, replyDelayMs); else reply();
  });
});

function rq(method, p, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: APP_PORT, path: p, method, timeout: 20000, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'x-token': token } : {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: d }); });
    });
    r.on('error', () => resolve({ status: 0, body: {}, raw: '' }));
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (data) r.write(data); r.end();
  });
}
const tokenOf = s => { const m = /#reset=([A-Za-z0-9_.%-]+)/.exec(s || ''); return m ? decodeURIComponent(m[1]) : ''; };

// args: ['server.js'] = the long-running server; ['-e', ...] = api/index.js behind http, as on Vercel.
async function startApp(args, dataDir) {
  const app = spawn(process.execPath, args, {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(APP_PORT), HOST: '127.0.0.1', GQA_DATA_DIR: dataDir, DATABASE_URL: '', NODE_ENV: '', LDAP_ENABLED: '',
      ADMIN_PASSWORD: 'BreakGlass123', ADMIN_EMAIL,
      SMTP_HOST: '', SMTP_ENABLED: '', NOTIFY_EMAIL_TO: '',
      RESEND_API_KEY: API_KEY, RESEND_API_URL: 'http://127.0.0.1:' + STUB_PORT + '/emails', EMAIL_FROM: FROM,
      APP_URL: 'https://qa.golden.test/',
    }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  app.stderr.on('data', d => console.log('APP-ERR: ' + String(d).trim()));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { const h = await rq('GET', '/api/health'); up = h.status === 200; if (!up) await sleep(200); }
  return { app, up };
}
const stopApp = app => new Promise(r => { if (!app || app.exitCode !== null) return r(); app.once('exit', () => r()); try { app.kill('SIGKILL'); } catch (e) { r(); } });

stub.listen(STUB_PORT, '127.0.0.1', async () => {
  let { app, up } = await startApp(['server.js'], DATA_DIR);

  try {
    ok('server is up', up);
    let r = await rq('GET', '/api/config');
    ok('config: passwordReset.email is true with only RESEND_API_KEY + EMAIL_FROM + APP_URL', !!(r.body.passwordReset && r.body.passwordReset.email === true), JSON.stringify(r.body.passwordReset));
    ok('config never exposes the API key', !r.raw.includes(API_KEY));

    // self-service: forgot by e-mail address -> one Resend call carrying a working link
    await sleep(500); calls.length = 0; // drop any boot-time reminder e-mails
    r = await rq('POST', '/api/password/forgot', { identifier: ADMIN_EMAIL.toUpperCase() });
    ok('forgot -> 200 {ok:true}', r.status === 200 && r.body.ok === true, r.status + ' ' + r.raw);
    const c = calls.find(x => (x.body.to || []).includes(ADMIN_EMAIL)) || {};
    ok('Resend called once with POST /emails', calls.length === 1 && c.method === 'POST' && c.url === '/emails', JSON.stringify(calls.map(x => x.method + ' ' + x.url)));
    ok('Authorization: Bearer <RESEND_API_KEY>', c.auth === 'Bearer ' + API_KEY, c.auth ? '(other value)' : '(missing)');
    ok('from = EMAIL_FROM, to = the account e-mail', c.body && c.body.from === FROM && JSON.stringify(c.body.to) === JSON.stringify([ADMIN_EMAIL]), JSON.stringify(c.body && { from: c.body.from, to: c.body.to }));
    ok('subject + text + html present', !!(c.body && c.body.subject && c.body.text && c.body.html), Object.keys(c.body || {}).join(','));
    ok('link is built from APP_URL (trailing slash dropped), as a #reset= fragment', /https:\/\/qa\.golden\.test\/#reset=/.test((c.body && c.body.text) || ''), ((c.body && c.body.text) || '').slice(0, 200));
    const tok = tokenOf(c.body && c.body.text);
    r = await rq('POST', '/api/password/reset/check', { token: tok });
    ok('e-mailed link checks out for admin', r.status === 200 && r.body.user && r.body.user.id === 'admin', r.status + ' ' + r.raw);
    r = await rq('POST', '/api/password/reset', { token: tok, password: 'ViaResend99' });
    ok('e-mailed link resets the password and signs in', r.status === 200 && !!r.body.token, r.status + ' ' + r.raw);
    const adminTok = r.body.token;
    r = await rq('POST', '/api/login', { username: 'admin', password: 'ViaResend99' });
    ok('new password signs in', r.status === 200, String(r.status));

    // admin-issued link e-mailed through Resend
    calls.length = 0;
    r = await rq('POST', '/api/admin/users/admin/reset-link', { email: true }, adminTok);
    ok('reset-link {email:true} -> emailed:true', r.status === 200 && r.body.emailed === true, r.status + ' ' + r.raw);
    ok('reset-link e-mail went through Resend', calls.length === 1 && tokenOf(calls[0].body.text) === r.body.token, calls.length + ' call(s)');

    // Resend refuses -> 502 carrying Resend's message (not the key)
    refuseNext = true;
    r = await rq('POST', '/api/admin/users/admin/reset-link', { email: true }, adminTok);
    ok('Resend error -> 502 with Resend\'s message', r.status === 502 && /Resend 422/.test(r.body.error || '') && /not verified/.test(r.body.error || ''), r.status + ' ' + r.raw);
    ok('error response does not contain the API key', !r.raw.includes(API_KEY));

    // admin-side alert: a reset request from an account with no e-mail goes to the Administrators only,
    // not to the operational list (NOTIFY_EMAIL_TO / config.json notify.email.to)
    r = await rq('POST', '/api/admin/users', { id: 'nomail', name: 'No Mail', role: 'QA Officer', password: 'secret1' }, adminTok);
    ok('created a QA Officer with no e-mail', r.status === 200, r.status + ' ' + r.raw);
    calls.length = 0;
    r = await rq('POST', '/api/password/forgot', { identifier: 'nomail' });
    await sleep(800); // alert e-mails are fire-and-forget on the long-running server
    const resetAlert = calls.find(x => /Password reset requested/.test((x.body && x.body.subject) || ''));
    ok('reset-request alert e-mailed', !!resetAlert, JSON.stringify(calls.map(x => x.body && x.body.subject)));
    ok('reset-request alert goes to the Administrator e-mail only', !!resetAlert && JSON.stringify(resetAlert.body.to) === JSON.stringify([ADMIN_EMAIL]), JSON.stringify(resetAlert && resetAlert.body.to));

    r = await rq('GET', '/api/audit?limit=1000', null, adminTok);
    ok('audit log never contains the API key', r.status === 200 && !r.raw.includes(API_KEY), String(r.status));
    r = await rq('GET', '/api/audit/verify', null, adminTok);
    ok('audit chain intact', r.body && r.body.ok === true, JSON.stringify(r.body));

    // serverless (Vercel) mode: a fire-and-forget alert must be answered before the response goes out
    await stopApp(app);
    ({ app, up } = await startApp(['-e', "require('http').createServer(require('./api/index.js')).listen(" + APP_PORT + ", '127.0.0.1')"], DATA_DIR2));
    ok('serverless: api/index.js handler is up', up);
    r = await rq('POST', '/api/login', { username: 'admin', password: 'BreakGlass123' });
    const svTok = r.body.token;
    const JOB = 'RESEND-' + process.pid;
    r = await rq('POST', '/api/jobs', { jobNo: JOB, machine: 'Flexo450', customer: 'StarKist', product: 'Resend smoke label', description: 'resend smoke job' }, svTok);
    ok('serverless: job created', r.status === 200, r.status + ' ' + r.raw);
    calls.length = 0; replyDelayMs = 400;
    r = await rq('POST', '/api/jobs/' + encodeURIComponent(JOB) + '/hold', { reason: 'resend smoke' }, svTok);
    const holdCall = calls.find(x => /placed on HOLD/.test((x.body && x.body.subject) || ''));
    replyDelayMs = 0;
    ok('serverless: hold -> 200', r.status === 200, r.status + ' ' + r.raw);
    ok('serverless: hold alert was answered by Resend BEFORE the response went out', !!(holdCall && holdCall.replied), holdCall ? 'sent, but the response went out first' : calls.length + ' call(s), none for the hold');
    ok('operational alert (hold) does not go to the Administrator', !!holdCall && !(holdCall.body.to || []).includes(ADMIN_EMAIL), JSON.stringify(holdCall && holdCall.body.to));
  } catch (e) { console.log('TEST ERROR:', e && e.stack ? e.stack : e); fail++; }

  console.log('\nResend smoke summary: ' + pass + ' passed, ' + fail + ' failed');
  await stopApp(app);
  stub.close();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(DATA_DIR2, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
});
