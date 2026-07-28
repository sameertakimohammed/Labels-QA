'use strict';
/* Golden QA App - zero-dependency smoke / integration test runner.
 * Spawns the real server on a throwaway port, exercises the HTTP API with only
 * the built-in `http` client, and ALWAYS restores data/db.json + kills the child.
 * Run: node test/smoke.js   (exit 0 = all pass, exit 1 = at least one failure)
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');           // repo working dir
// Run against an isolated throwaway data dir so the test never reads or mutates
// the real data/ folder (incl. its .bak fallback) and can't be cross-contaminated.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gqa-smoke-'));
const PORT = 34567;
const HOST = '127.0.0.1';
const PID = process.pid;

/* ---------- tiny test harness ---------- */
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- tiny http client (built-in only) ---------- */
function request(method, p, body, token, apiKey) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    if (token) headers['x-token'] = token;
    if (apiKey) headers['x-api-key'] = apiKey;
    const req = http.request({ host: HOST, port: PORT, method, path: p, headers, timeout: 8000 }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch (e) { json = null; }
        resolve({ status: res.statusCode, body: json, raw: buf });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout ' + method + ' ' + p)); });
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* poll /api/health until ready or timeout (~10s) */
async function waitForReady() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const r = await request('GET', '/api/health');
      if (r.status === 200 && r.body && r.body.ok) return true;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

/* ---------- isolated data dir cleanup ---------- */
function cleanupDataDir() {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
}

/* ---------- main ---------- */
async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), GQA_DATA_DIR: DATA_DIR }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childExited = false, childExitInfo = '';
  child.on('exit', (code, sig) => { childExited = true; childExitInfo = 'code=' + code + ' sig=' + sig; });
  // surface server crashes for debugging without polluting normal runs
  child.stderr.on('data', (d) => { process.stderr.write('[server] ' + d); });

  try {
    const ready = await waitForReady();
    if (!ready) {
      console.log('FAIL  server did not become ready within 10s' + (childExited ? ' (child exited ' + childExitInfo + ')' : ''));
      failed++;
      return; // finally still runs (kill + restore)
    }

    // 1. health
    let r = await request('GET', '/api/health');
    eq('health returns 200', r.status, 200);
    ok('health ok:true and org present', !!(r.body && r.body.ok && r.body.org), JSON.stringify(r.body));

    // 2. login admin / admin123
    r = await request('POST', '/api/login', { username: 'admin', password: 'admin123' });
    eq('login admin/admin123 returns 200', r.status, 200);
    let adminToken = r.body && r.body.token;
    ok('login admin returns token', !!adminToken, JSON.stringify(r.body));

    // 3. login wrong password -> 401
    r = await request('POST', '/api/login', { username: 'admin', password: 'wrongpass' });
    eq('login admin with wrong password -> 401', r.status, 401);

    // 4. admin user list (manager) includes admin
    r = await request('GET', '/api/admin/users', undefined, adminToken);
    eq('GET /api/admin/users returns 200', r.status, 200);
    ok("GET /api/admin/users includes 'admin'",
      Array.isArray(r.body) && r.body.some((u) => u && u.id === 'admin'),
      JSON.stringify(r.body));

    // 5. /api/me with token
    r = await request('GET', '/api/me', undefined, adminToken);
    eq('GET /api/me returns 200', r.status, 200);
    ok('GET /api/me returns the admin user',
      !!(r.body && r.body.user && r.body.user.id === 'admin'),
      JSON.stringify(r.body));

    // unauthenticated /api/me -> 401
    r = await request('GET', '/api/me');
    eq('GET /api/me without token -> 401', r.status, 401);

    // 6. create a uniquely named job
    const JOB = 'SMOKE-' + PID;
    r = await request('POST', '/api/jobs',
      { jobNo: JOB, machine: 'Flexo450', customer: 'StarKist', product: 'Smoke Test Label', description: 'smoke test job' },
      adminToken);
    eq('POST /api/jobs creates job (200)', r.status, 200);
    ok('created job has correct jobNo', !!(r.body && r.body.jobNo === JOB), JSON.stringify(r.body && r.body.jobNo));

    // 7. GET that job
    r = await request('GET', '/api/jobs/' + encodeURIComponent(JOB), undefined, adminToken);
    eq('GET /api/jobs/:jobNo returns 200', r.status, 200);
    ok('fetched job matches and machine is Flexo450',
      !!(r.body && r.body.jobNo === JOB && r.body.machine === 'Flexo450'),
      JSON.stringify(r.body && { jobNo: r.body.jobNo, machine: r.body.machine }));

    // 8. PUT stage 3 _done:true while stage 1 not done -> 409 (flow is 1 -> 3 -> 4)
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(JOB) + '/stage/3',
      { data: { _done: true, date: '2026-06-23', operatorName: 'M. Singh', startTime: '06:00', finishTime: '10:00' } },
      adminToken);
    eq('PUT stage 3 before stage 1 -> 409', r.status, 409);

    // 8b. stage 2 (Reel Inspection) is out of the QA flow — it's a legacy write sink for offline
    // tablets: accepted without gating, but never counted toward completion/status.
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(JOB) + '/stage/2',
      { data: { _done: true, date: '2026-06-23', qaOfficer: 'A. Kumar', rows: [{ roll: '1', totalMeters: '100' }] } },
      adminToken);
    eq('legacy PUT stage 2 accepted -> 200', r.status, 200);
    r = await request('GET', '/api/jobs', undefined, adminToken);
    const smokeRow = (r.body || []).find((j) => j.jobNo === JOB);
    ok('legacy stage 2 does not count toward completion',
      !!(smokeRow && smokeRow.completed === 0 && smokeRow.status === 'New'),
      JSON.stringify(smokeRow && { completed: smokeRow.completed, status: smokeRow.status }));

    // 9. PUT stage 1 _done:true with EMPTY data -> 400 with missing[]
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(JOB) + '/stage/1',
      { data: { _done: true } },
      adminToken);
    eq('PUT stage 1 with empty data -> 400', r.status, 400);
    ok('400 body includes non-empty missing[]',
      !!(r.body && Array.isArray(r.body.missing) && r.body.missing.length > 0),
      JSON.stringify(r.body));

    // 10. PUT stage 1 with valid required fields -> 200
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(JOB) + '/stage/1',
      { data: { _done: true, date: '2026-06-23', qaOfficer: 'A. Kumar', proceed: 'Yes', materialType: 'BOPP White 60um' } },
      adminToken);
    eq('PUT stage 1 with valid fields -> 200', r.status, 200);
    ok('stage 1 now marked _done',
      !!(r.body && r.body.stage1 && r.body.stage1._done === true),
      JSON.stringify(r.body && r.body.stage1));

    // 10a. stage 4 straight after stage 1 -> 409 (stage 3 is its predecessor; removed stage 2 is skipped)
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(JOB) + '/stage/4',
      { data: { _done: true, date: '2026-06-23', checks: [{ time: '08:00' }], signature: 'data:image/png;base64,x' } },
      adminToken);
    eq('PUT stage 4 before stage 3 -> 409', r.status, 409);

    // 10a2. complete the remaining flow stages 3 then 4 -> job Released at 3 of 3
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(JOB) + '/stage/3',
      { data: { _done: true, date: '2026-06-23', operatorName: 'M. Singh', startTime: '06:00', finishTime: '10:00' } },
      adminToken);
    eq('PUT stage 3 after stage 1 -> 200', r.status, 200);
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(JOB) + '/stage/4',
      { data: { _done: true, date: '2026-06-23', checks: [{ time: '08:00' }], signature: 'data:image/png;base64,x' } },
      adminToken);
    eq('PUT stage 4 after stage 3 -> 200', r.status, 200);
    r = await request('GET', '/api/jobs', undefined, adminToken);
    const relRow = (r.body || []).find((j) => j.jobNo === JOB);
    ok('job Released once the 3 flow stages complete',
      !!(relRow && relRow.completed === 3 && relRow.status === 'Released'),
      JSON.stringify(relRow && { completed: relRow.completed, status: relRow.status }));

    // 10b. edit job metadata
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(JOB), { product: 'Edited Label', customer: 'StarKist' }, adminToken);
    eq('PUT /api/jobs/:jobNo edits metadata -> 200', r.status, 200);
    ok('job product updated', !!(r.body && r.body.product === 'Edited Label'), JSON.stringify(r.body && r.body.product));

    // 10c. clone job
    const CLONE = JOB + '-C';
    r = await request('POST', '/api/jobs/' + encodeURIComponent(JOB) + '/clone', { jobNo: CLONE }, adminToken);
    eq('POST /api/jobs/:jobNo/clone -> 200', r.status, 200);
    ok('clone has empty stage1', !!(r.body && r.body.stage1 && r.body.stage1._done === false), JSON.stringify(r.body && r.body.stage1));

    // 10d. delete the clone = archive (record + lookup survive; lists/KPIs exclude it; restorable)
    r = await request('GET', '/api/analytics', undefined, adminToken);
    const totalBeforeArchive = r.body && r.body.kpis && r.body.kpis.total;
    const earlyOfficerTok = ((await request('POST', '/api/login', { username: 'akumar', password: 'kumar123' })).body || {}).token;
    r = await request('DELETE', '/api/jobs/' + encodeURIComponent(CLONE), undefined, earlyOfficerTok);
    eq('non-QM DELETE job -> 403', r.status, 403);
    r = await request('DELETE', '/api/jobs/' + encodeURIComponent(CLONE), undefined, adminToken);
    eq('DELETE /api/jobs/:jobNo (archive) -> 200', r.status, 200);
    r = await request('GET', '/api/jobs/' + encodeURIComponent(CLONE), undefined, adminToken);
    ok('archived job still fetchable by jobNo (lookup keeps working)', r.status === 200 && r.body.archived === true, JSON.stringify(r.body && { a: r.body.archived, by: r.body.archivedBy }));
    r = await request('GET', '/api/jobs', undefined, adminToken);
    ok('archived job hidden from default list', !(r.body || []).some((j) => j.jobNo === CLONE), CLONE);
    r = await request('GET', '/api/jobs?archived=1', undefined, adminToken);
    ok('archived job listed via ?archived=1 with flag', (r.body || []).some((j) => j.jobNo === CLONE && j.archived === true), JSON.stringify(r.body && r.body.length));
    r = await request('GET', '/api/analytics', undefined, adminToken);
    ok('archived job excluded from analytics totals', r.body.kpis.total === totalBeforeArchive - 1, 'before=' + totalBeforeArchive + ' after=' + r.body.kpis.total);
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(CLONE) + '/stage/1', { data: { note: 'x' } }, adminToken);
    eq('stage save on archived job -> 409', r.status, 409);
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(CLONE), { product: 'nope' }, adminToken);
    eq('edit archived job -> 409', r.status, 409);
    r = await request('POST', '/api/jobs/' + encodeURIComponent(CLONE) + '/hold', { reason: 'x' }, adminToken);
    eq('hold archived job -> 409', r.status, 409);
    r = await request('POST', '/api/jobs', { jobNo: CLONE, machine: 'Flexo450' }, adminToken);
    ok('creating a job with an archived jobNo -> 409 with archive hint', r.status === 409 && /archive/i.test((r.body || {}).error || ''), JSON.stringify(r.body));
    r = await request('DELETE', '/api/jobs/' + encodeURIComponent(CLONE), undefined, adminToken);
    eq('archive an archived job -> 409', r.status, 409);
    r = await request('POST', '/api/jobs/' + encodeURIComponent(CLONE) + '/restore', undefined, earlyOfficerTok);
    eq('non-QM restore job -> 403', r.status, 403);
    r = await request('POST', '/api/jobs/' + encodeURIComponent(CLONE) + '/restore', undefined, adminToken);
    eq('POST /api/jobs/:jobNo/restore -> 200', r.status, 200);
    r = await request('GET', '/api/jobs', undefined, adminToken);
    const restJob = (r.body || []).find((j) => j.jobNo === CLONE);
    ok('restored job back in default list unarchived', !!restJob && !restJob.archived, JSON.stringify(restJob && { a: restJob.archived }));
    r = await request('POST', '/api/jobs/' + encodeURIComponent(CLONE) + '/restore', undefined, adminToken);
    eq('restore a non-archived job -> 409', r.status, 409);
    // leave the clone archived so later list/count assertions see only the primary job
    await request('DELETE', '/api/jobs/' + encodeURIComponent(CLONE), undefined, adminToken);

    // 10e. backups status endpoint
    r = await request('GET', '/api/admin/backups', undefined, adminToken);
    eq('GET /api/admin/backups -> 200', r.status, 200);

    // 11. analytics returns kpis
    r = await request('GET', '/api/analytics', undefined, adminToken);
    eq('GET /api/analytics returns 200', r.status, 200);
    ok('analytics returns kpis object',
      !!(r.body && r.body.kpis && typeof r.body.kpis.total === 'number'),
      JSON.stringify(r.body && r.body.kpis));

    // 12. admin user lifecycle
    const NEWUSER = 'smoke' + PID;
    r = await request('POST', '/api/admin/users',
      { id: NEWUSER, name: 'Smoke Test User', role: 'QA Officer', password: 'secret123' },
      adminToken);
    eq('admin create user -> 200', r.status, 200);

    // duplicate create -> 409
    r = await request('POST', '/api/admin/users',
      { id: NEWUSER, name: 'Smoke Test User', role: 'QA Officer', password: 'secret123' },
      adminToken);
    eq('admin create duplicate user -> 409', r.status, 409);

    // PUT change role
    r = await request('PUT', '/api/admin/users/' + encodeURIComponent(NEWUSER),
      { role: 'Supervisor' },
      adminToken);
    eq('admin update user role -> 200', r.status, 200);
    ok('updated user has role Supervisor',
      !!(r.body && Array.isArray(r.body.users) && r.body.users.some((u) => u.id === NEWUSER && u.role === 'Supervisor')),
      JSON.stringify(r.body && r.body.users && r.body.users.find((u) => u.id === NEWUSER)));

    // DELETE it
    r = await request('DELETE', '/api/admin/users/' + encodeURIComponent(NEWUSER), undefined, adminToken);
    eq('admin delete user -> 200', r.status, 200);
    ok('deleted user no longer present',
      !!(r.body && Array.isArray(r.body.users) && !r.body.users.some((u) => u.id === NEWUSER)),
      'still present');

    // 12b. user delete is an archive: sign-in blocked, sessions killed, restorable
    const ARCUSER = 'arcu' + PID;
    await request('POST', '/api/admin/users', { id: ARCUSER, name: 'Arc User', role: 'QA Officer', password: 'secret123' }, adminToken);
    r = await request('POST', '/api/login', { username: ARCUSER, password: 'secret123' });
    const arcUserTok = r.body && r.body.token;
    ok('archive-test user can sign in before archive', !!arcUserTok, JSON.stringify(r.body));
    r = await request('DELETE', '/api/admin/users/' + encodeURIComponent(ARCUSER), undefined, adminToken);
    eq('archive user -> 200', r.status, 200);
    r = await request('GET', '/api/me', undefined, arcUserTok);
    eq('archived user session killed -> 401', r.status, 401);
    r = await request('POST', '/api/login', { username: ARCUSER, password: 'secret123' });
    eq('archived user sign-in -> 403', r.status, 403);
    r = await request('GET', '/api/admin/users?archived=1', undefined, adminToken);
    ok('archived user listed via ?archived=1', (r.body || []).some((u) => u.id === ARCUSER && u.archived === true), JSON.stringify(r.body && r.body.length));
    r = await request('POST', '/api/admin/users', { id: ARCUSER, name: 'Dup', role: 'QA Officer', password: 'secret123' }, adminToken);
    ok('re-creating archived user id -> 409 with restore hint', r.status === 409 && /archive/i.test((r.body || {}).error || ''), JSON.stringify(r.body));
    r = await request('PUT', '/api/admin/users/' + encodeURIComponent(ARCUSER), { name: 'nope' }, adminToken);
    eq('edit archived user -> 409', r.status, 409);
    r = await request('DELETE', '/api/admin/users/' + encodeURIComponent(ARCUSER), undefined, adminToken);
    eq('archive an archived user -> 409', r.status, 409);
    r = await request('POST', '/api/admin/users/' + encodeURIComponent(ARCUSER) + '/restore', undefined, adminToken);
    eq('POST /api/admin/users/:id/restore -> 200', r.status, 200);
    r = await request('POST', '/api/login', { username: ARCUSER, password: 'secret123' });
    eq('restored user can sign in again', r.status, 200);
    r = await request('POST', '/api/admin/users/' + encodeURIComponent(ARCUSER) + '/restore', undefined, adminToken);
    eq('restore a non-archived user -> 409', r.status, 409);
    await request('DELETE', '/api/admin/users/' + encodeURIComponent(ARCUSER), undefined, adminToken);

    // 12c. template delete is an archive: stops matching new jobs, restorable
    r = await request('POST', '/api/templates', { name: 'Arc TPL ' + PID, machine: 'Flexo450', settings: { machineSpeed: '111' } }, adminToken);
    const arcTpl = r.body && r.body.id;
    r = await request('DELETE', '/api/templates/' + encodeURIComponent(arcTpl), undefined, adminToken);
    eq('DELETE /api/templates/:id (archive) -> 200', r.status, 200);
    r = await request('GET', '/api/templates', undefined, adminToken);
    ok('archived template hidden from default list', !(r.body || []).some((t) => t.id === arcTpl), arcTpl);
    r = await request('GET', '/api/templates?archived=1', undefined, adminToken);
    ok('archived template listed via ?archived=1', (r.body || []).some((t) => t.id === arcTpl && t.archived === true), JSON.stringify(r.body && r.body.length));
    r = await request('POST', '/api/jobs', { jobNo: 'TPLARC-' + PID, machine: 'Flexo450' }, adminToken);
    ok('archived template no longer applied to new jobs', r.status === 200 && r.body.templateApplied !== 'Arc TPL ' + PID, JSON.stringify(r.body && r.body.templateApplied));
    await request('DELETE', '/api/jobs/' + encodeURIComponent('TPLARC-' + PID), undefined, adminToken);
    r = await request('PUT', '/api/templates/' + encodeURIComponent(arcTpl), { name: 'nope' }, adminToken);
    eq('edit archived template -> 409', r.status, 409);
    r = await request('POST', '/api/templates/' + encodeURIComponent(arcTpl) + '/restore', undefined, adminToken);
    eq('POST /api/templates/:id/restore -> 200', r.status, 200);
    r = await request('GET', '/api/templates', undefined, adminToken);
    ok('restored template back in list', (r.body || []).some((t) => t.id === arcTpl && !t.archived), arcTpl);
    await request('DELETE', '/api/templates/' + encodeURIComponent(arcTpl), undefined, adminToken);

    // 12d. checklist-def delete is an archive: leaves pickers/due, restorable
    r = await request('POST', '/api/checklist-defs', { code: 'F-DARC', title: 'Def archive test', frequency: 'daily', items: [{ label: 'One' }] }, adminToken);
    const arcDefX = r.body && r.body.id;
    r = await request('DELETE', '/api/checklist-defs/' + encodeURIComponent(arcDefX), undefined, adminToken);
    eq('DELETE /api/checklist-defs/:id (archive) -> 200', r.status, 200);
    r = await request('GET', '/api/checklist-defs', undefined, adminToken);
    ok('archived form hidden from defs list', !(r.body || []).some((d) => d.id === arcDefX), arcDefX);
    r = await request('GET', '/api/checklists/due', undefined, adminToken);
    ok('archived form absent from due tracking', !(r.body || []).some((d) => d.code === 'F-DARC'), 'F-DARC');
    r = await request('PUT', '/api/checklist-defs/' + encodeURIComponent(arcDefX), { title: 'nope' }, adminToken);
    eq('edit archived form -> 409', r.status, 409);
    r = await request('POST', '/api/checklist-defs/' + encodeURIComponent(arcDefX) + '/restore', undefined, adminToken);
    eq('POST /api/checklist-defs/:id/restore -> 200', r.status, 200);
    r = await request('GET', '/api/checklist-defs', undefined, adminToken);
    ok('restored form back in defs list', (r.body || []).some((d) => d.id === arcDefX && !d.archived), arcDefX);
    await request('DELETE', '/api/checklist-defs/' + encodeURIComponent(arcDefX), undefined, adminToken);

    // 13. non-manager cannot manage users -> 403
    r = await request('POST', '/api/login', { username: 'akumar', password: 'kumar123' });
    eq('login akumar (QA Officer) -> 200', r.status, 200);
    const officerToken = r.body && r.body.token;
    ok('akumar login returns token', !!officerToken, JSON.stringify(r.body));
    r = await request('POST', '/api/admin/users',
      { id: 'nope' + PID, name: 'Nope', role: 'QA Officer', password: 'secret123' },
      officerToken);
    eq('non-manager POST /api/admin/users -> 403', r.status, 403);

    // 14. self-service password change (My Account)
    r = await request('POST', '/api/me/password', { current: 'wrongpw', new: 'newpass123' }, adminToken);
    eq('change password with wrong current -> 401', r.status, 401);
    r = await request('POST', '/api/me/password', { current: 'admin123', new: 'x' }, adminToken);
    eq('change password too short -> 400', r.status, 400);
    r = await request('POST', '/api/me/password', { current: 'admin123', new: 'newpass123' }, adminToken);
    eq('change password -> 200', r.status, 200);
    ok('change password returns a fresh token', !!(r.body && r.body.token), JSON.stringify(r.body));
    adminToken = (r.body && r.body.token) || adminToken; // password change rotates the token (old ones are invalidated)
    r = await request('POST', '/api/login', { username: 'admin', password: 'newpass123' });
    eq('login with new password -> 200', r.status, 200);

    // 15. tamper-evident audit chain
    r = await request('GET', '/api/audit/verify', undefined, adminToken);
    eq('GET /api/audit/verify -> 200', r.status, 200);
    ok('audit chain intact (ok:true, checked>0)', !!(r.body && r.body.ok === true && r.body.checked > 0), JSON.stringify(r.body));

    // 16. CAPA lifecycle
    const CAPATITLE = 'Smoke CAPA ' + PID;
    r = await request('POST', '/api/capas', { title: CAPATITLE, jobNo: JOB, severity: 'High', source: 'smoke' }, adminToken);
    eq('POST /api/capas -> 200', r.status, 200);
    const capaId = r.body && r.body.id;
    ok('created CAPA has id and status Open', !!(capaId && r.body.status === 'Open'), JSON.stringify(r.body));

    r = await request('POST', '/api/capas', { jobNo: JOB }, adminToken);
    eq('POST /api/capas without title -> 400', r.status, 400);

    r = await request('GET', '/api/capas?status=Open', undefined, adminToken);
    ok('GET /api/capas?status=Open includes the new CAPA',
      Array.isArray(r.body) && r.body.some((c) => c.id === capaId), JSON.stringify(r.body && r.body.length));

    r = await request('PUT', '/api/capas/' + encodeURIComponent(capaId), { status: 'Closed', rootCause: 'identified' }, adminToken);
    eq('PUT /api/capas/:id close -> 200', r.status, 200);
    ok('closed CAPA has closedAt + closedBy',
      !!(r.body && r.body.status === 'Closed' && r.body.closedAt && r.body.closedBy === 'admin'),
      JSON.stringify(r.body && { s: r.body.status, by: r.body.closedBy }));

    r = await request('POST', '/api/capas', { title: 'nope' }, officerToken);
    eq('non-manager POST /api/capas -> 403', r.status, 403);

    // 17. analytics with filters returns trend + openCapas
    r = await request('GET', '/api/analytics?from=2000-01-01&to=2099-12-31', undefined, adminToken);
    eq('GET /api/analytics (filtered) -> 200', r.status, 200);
    ok('analytics has trend[] and kpis.openCapas',
      !!(r.body && Array.isArray(r.body.trend) && typeof r.body.kpis.openCapas === 'number'),
      JSON.stringify(r.body && r.body.kpis));

    // 18. restore guards (no actual restore — destructive)
    r = await request('POST', '/api/admin/restore', { name: '../../etc/passwd' }, adminToken);
    eq('restore with bad name -> 400', r.status, 400);
    r = await request('POST', '/api/admin/restore', { name: 'db-20260101-000000.json' }, officerToken);
    eq('non-admin restore -> 403', r.status, 403);

    // 19. login throttle: repeated failures lock the account out (unique user, isolated key)
    const LOCKUSER = 'lockme' + PID;
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) { const rr = await request('POST', '/api/login', { username: LOCKUSER, password: 'bad' }); lastStatus = rr.status; }
    ok('5 bad logins all returned 401', lastStatus === 401, 'last=' + lastStatus);
    r = await request('POST', '/api/login', { username: LOCKUSER, password: 'bad' });
    eq('6th attempt locked out -> 429', r.status, 429);

    // 20. equipment & calibration register
    r = await request('GET', '/api/equipment', undefined, adminToken);
    eq('GET /api/equipment -> 200', r.status, 200);
    ok('equipment list computes calStatus', Array.isArray(r.body) && r.body.every((e) => typeof e.calStatus === 'string'), JSON.stringify(r.body && r.body.length));

    r = await request('POST', '/api/equipment', { name: 'Smoke Gauge ' + PID, type: 'Gauge', calibratedOn: '2020-01-01', calibrationIntervalDays: 30 }, adminToken);
    eq('POST /api/equipment -> 200', r.status, 200);
    const eqId = r.body && r.body.id;
    ok('new equipment with old cal date is Overdue', !!(eqId && r.body.calStatus === 'Overdue'), JSON.stringify(r.body && { s: r.body.calStatus, due: r.body.nextDue }));

    r = await request('POST', '/api/equipment', { type: 'Gauge' }, adminToken);
    eq('POST /api/equipment without name -> 400', r.status, 400);

    r = await request('POST', '/api/equipment/' + encodeURIComponent(eqId) + '/calibrate', { result: 'Pass', intervalDays: 365 }, adminToken);
    eq('POST /api/equipment/:id/calibrate -> 200', r.status, 200);
    ok('status is OK after a fresh calibration', !!(r.body && r.body.calStatus === 'OK'), JSON.stringify(r.body && r.body.calStatus));

    r = await request('POST', '/api/equipment', { name: 'nope' }, officerToken);
    eq('non-manager POST /api/equipment -> 403', r.status, 403);

    // 20b. equipment archive (DELETE = soft archive; history kept; restorable)
    const ARCNAME = 'Smoke Archive Gauge ' + PID;
    r = await request('POST', '/api/equipment', { name: ARCNAME, type: 'Gauge', calibratedOn: '2020-01-01', calibrationIntervalDays: 30 }, adminToken);
    const arcId = r.body && r.body.id;
    await request('POST', '/api/equipment/' + encodeURIComponent(arcId) + '/calibrate', { result: 'Pass', intervalDays: 365 }, adminToken);
    r = await request('DELETE', '/api/equipment/' + encodeURIComponent(arcId), undefined, officerToken);
    eq('non-manager DELETE equipment -> 403', r.status, 403);
    r = await request('DELETE', '/api/equipment/' + encodeURIComponent(arcId), undefined, adminToken);
    eq('DELETE /api/equipment/:id (archive) -> 200', r.status, 200);
    r = await request('GET', '/api/equipment', undefined, adminToken);
    ok('archived item hidden from default list', !(r.body || []).some((e) => e.id === arcId), arcId);
    r = await request('GET', '/api/equipment?archived=1', undefined, adminToken);
    const arcRow = (r.body || []).find((e) => e.id === arcId);
    ok('archived item listed via ?archived=1 with archivedBy', !!(arcRow && arcRow.archived === true && arcRow.archivedBy === 'admin'), JSON.stringify(arcRow && { a: arcRow.archived, by: arcRow.archivedBy }));
    r = await request('GET', '/api/equipment/' + encodeURIComponent(arcId) + '/history', undefined, adminToken);
    ok('calibration history survives archive', r.status === 200 && (r.body.history || []).length === 1, JSON.stringify(r.body && r.body.history && r.body.history.length));
    r = await request('GET', '/api/equipment/calibration-history.csv', undefined, adminToken);
    ok('archived item kept in calibration CSV extract', r.status === 200 && r.raw.includes(ARCNAME), 'csv len=' + r.raw.length);
    r = await request('POST', '/api/equipment/' + encodeURIComponent(arcId) + '/calibrate', { result: 'Pass' }, adminToken);
    eq('calibrate archived equipment -> 409', r.status, 409);
    r = await request('PUT', '/api/equipment/' + encodeURIComponent(arcId), { name: 'renamed' }, adminToken);
    eq('PUT archived equipment -> 409', r.status, 409);
    r = await request('GET', '/api/exec', undefined, adminToken);
    ok('archived item excluded from exec overdue-cal list', !((r.body.lists || {}).overdueCal || []).some((e) => e.id === arcId), arcId);
    r = await request('DELETE', '/api/equipment/' + encodeURIComponent(arcId), undefined, adminToken);
    eq('archive an archived item -> 409', r.status, 409);
    r = await request('DELETE', '/api/equipment/EQ-NOPE-' + PID, undefined, adminToken);
    eq('archive unknown equipment -> 404', r.status, 404);
    r = await request('POST', '/api/equipment/' + encodeURIComponent(arcId) + '/restore', undefined, officerToken);
    eq('non-manager restore -> 403', r.status, 403);
    r = await request('POST', '/api/equipment/' + encodeURIComponent(arcId) + '/restore', undefined, adminToken);
    eq('POST /api/equipment/:id/restore -> 200', r.status, 200);
    r = await request('GET', '/api/equipment', undefined, adminToken);
    const restRow = (r.body || []).find((e) => e.id === arcId);
    ok('restored item back in default list without archive fields', !!restRow && !restRow.archived && !restRow.archivedBy, JSON.stringify(restRow && { a: restRow.archived, by: restRow.archivedBy }));
    r = await request('POST', '/api/equipment/' + encodeURIComponent(arcId) + '/restore', undefined, adminToken);
    eq('restore a non-archived item -> 409', r.status, 409);

    // 21. executive dashboard (RAG vs targets)
    r = await request('GET', '/api/exec', undefined, adminToken);
    eq('GET /api/exec -> 200', r.status, 200);
    ok('exec returns kpis[] scored R/A/G + lists',
      !!(r.body && Array.isArray(r.body.kpis) && r.body.kpis.length >= 4 && r.body.kpis.every((k) => ['green', 'amber', 'red'].includes(k.rag)) && r.body.lists),
      JSON.stringify(r.body && r.body.kpis && r.body.kpis.map((k) => k.key + ':' + k.rag)));
    r = await request('GET', '/api/exec', undefined, officerToken);
    eq('non-manager GET /api/exec -> 403', r.status, 403);

    // 22. API keys (read-only)
    r = await request('POST', '/api/admin/apikeys', { name: 'Smoke key ' + PID }, adminToken);
    eq('POST /api/admin/apikeys -> 200', r.status, 200);
    const apiKey = r.body && r.body.key, keyId = r.body && r.body.id;
    ok('API key returned once with gqa_ prefix', !!(apiKey && /^gqa_/.test(apiKey)), JSON.stringify(r.body && Object.keys(r.body)));

    r = await request('GET', '/api/jobs', undefined, undefined, apiKey);
    eq('API key GET /api/jobs -> 200', r.status, 200);
    r = await request('POST', '/api/capas', { title: 'viakey' }, undefined, apiKey);
    eq('API key write -> 403 (read-only)', r.status, 403);
    r = await request('GET', '/api/exec', undefined, undefined, apiKey);
    eq('API key on manager-only /exec -> 403', r.status, 403);
    r = await request('DELETE', '/api/admin/apikeys/' + encodeURIComponent(keyId), undefined, adminToken);
    eq('revoke API key -> 200', r.status, 200);
    r = await request('GET', '/api/jobs', undefined, undefined, apiKey);
    eq('revoked API key -> 401', r.status, 401);
    r = await request('POST', '/api/admin/apikeys', { name: 'x' }, officerToken);
    eq('non-admin POST /api/admin/apikeys -> 403', r.status, 403);

    // 23. webhooks
    // 192.0.2.x is TEST-NET-1 (RFC 5737): reserved/unroutable, so the fire-and-forget delivery goes
    // nowhere, while still passing the SSRF guard (which blocks loopback/link-local, not TEST-NET).
    r = await request('POST', '/api/admin/webhooks', { url: 'http://192.0.2.1/none', events: ['job.released'] }, adminToken);
    eq('POST /api/admin/webhooks -> 200', r.status, 200);
    const hookId = r.body && r.body.id;
    r = await request('POST', '/api/admin/webhooks', { url: 'not-a-url' }, adminToken);
    eq('webhook bad url -> 400', r.status, 400);
    r = await request('GET', '/api/admin/webhooks', undefined, adminToken);
    ok('webhook list returns events[] + hooks[]', !!(r.body && Array.isArray(r.body.events) && Array.isArray(r.body.hooks)), JSON.stringify(r.body && Object.keys(r.body)));
    r = await request('DELETE', '/api/admin/webhooks/' + encodeURIComponent(hookId), undefined, adminToken);
    eq('delete webhook -> 200', r.status, 200);

    // 24. Prometheus metrics
    r = await request('GET', '/metrics');
    eq('GET /metrics -> 200', r.status, 200);
    ok('/metrics exposes gqa_ gauges', typeof r.raw === 'string' && r.raw.indexOf('gqa_jobs_total') >= 0, (r.raw || '').slice(0, 40));

    // 25. SPC + supplier scorecards
    r = await request('GET', '/api/spc?param=cof', undefined, adminToken);
    eq('GET /api/spc -> 200', r.status, 200);
    ok('spc returns points[]/mean/cpk/violations',
      !!(r.body && Array.isArray(r.body.points) && 'mean' in r.body && 'cpk' in r.body && Array.isArray(r.body.violations)),
      JSON.stringify(r.body && { n: r.body.n, mean: r.body.mean }));
    r = await request('GET', '/api/spc?param=registration', undefined, adminToken);
    eq('GET /api/spc?param=registration -> 200', r.status, 200);
    r = await request('GET', '/api/suppliers', undefined, adminToken);
    eq('GET /api/suppliers -> 200', r.status, 200);
    ok('suppliers returns scorecards with fpy',
      Array.isArray(r.body) && (r.body.length === 0 || (typeof r.body[0].fpy === 'number' && typeof r.body[0].jobs === 'number')),
      JSON.stringify(r.body && r.body.length));

    // 26. NCR -> CAPA workflow
    r = await request('POST', '/api/ncrs', { jobNo: JOB, description: 'Smoke NCR ' + PID, disposition: 'Rework', severity: 'High' }, adminToken);
    eq('POST /api/ncrs -> 200', r.status, 200);
    const ncrId = r.body && r.body.id;
    ok('NCR created Open with no CAPA yet', !!(ncrId && r.body.status === 'Open' && !r.body.capaId), JSON.stringify(r.body && { s: r.body.status, capa: r.body.capaId }));
    r = await request('POST', '/api/ncrs', { jobNo: JOB }, adminToken);
    eq('NCR without description -> 400', r.status, 400);
    r = await request('POST', '/api/ncrs/' + encodeURIComponent(ncrId) + '/capa', undefined, adminToken);
    eq('promote NCR to CAPA -> 200', r.status, 200);
    ok('promote links a CAPA back to the NCR', !!(r.body && r.body.capa && r.body.capa.id && r.body.ncr.capaId === r.body.capa.id), JSON.stringify(r.body && r.body.ncr));
    r = await request('POST', '/api/ncrs/' + encodeURIComponent(ncrId) + '/capa', undefined, adminToken);
    eq('double promote -> 409', r.status, 409);
    r = await request('POST', '/api/ncrs', { description: 'x' }, officerToken);
    eq('non-manager POST /api/ncrs -> 403', r.status, 403);

    // 27. CAPA effectiveness verification
    r = await request('POST', '/api/capas', { title: 'Eff ' + PID }, adminToken);
    const effCapa = r.body && r.body.id;
    r = await request('PUT', '/api/capas/' + encodeURIComponent(effCapa), { status: 'Closed', effectiveness: 'Verified' }, adminToken);
    eq('CAPA effectiveness verify -> 200', r.status, 200);
    ok('effectiveness recorded with verifier', !!(r.body && r.body.effectiveness === 'Verified' && r.body.verifiedBy === 'admin' && r.body.verifiedAt), JSON.stringify(r.body && { e: r.body.effectiveness, by: r.body.verifiedBy }));

    // 27b. CAPA archive (DELETE = soft archive; hidden from list + KPIs; restorable)
    r = await request('POST', '/api/capas', { title: 'Arch CAPA ' + PID, severity: 'High', dueDate: '2020-01-01' }, adminToken);
    const arcCapa = r.body && r.body.id;
    r = await request('DELETE', '/api/capas/' + encodeURIComponent(arcCapa), undefined, officerToken);
    eq('non-manager DELETE capa -> 403', r.status, 403);
    r = await request('DELETE', '/api/capas/' + encodeURIComponent(arcCapa), undefined, adminToken);
    eq('DELETE /api/capas/:id (archive) -> 200', r.status, 200);
    r = await request('GET', '/api/capas', undefined, adminToken);
    ok('archived CAPA hidden from default list', !(r.body || []).some((c) => c.id === arcCapa), arcCapa);
    r = await request('GET', '/api/capas?archived=1', undefined, adminToken);
    ok('archived CAPA listed via ?archived=1', (r.body || []).some((c) => c.id === arcCapa && c.archived === true && c.archivedBy === 'admin'), JSON.stringify(r.body && r.body.length));
    r = await request('GET', '/api/exec', undefined, adminToken);
    ok('archived CAPA excluded from exec overdue list', !((r.body.lists || {}).overdueCapas || []).some((c) => c.id === arcCapa), arcCapa);
    r = await request('PUT', '/api/capas/' + encodeURIComponent(arcCapa), { title: 'nope' }, adminToken);
    eq('PUT archived CAPA -> 409', r.status, 409);
    r = await request('DELETE', '/api/capas/' + encodeURIComponent(arcCapa), undefined, adminToken);
    eq('archive an archived CAPA -> 409', r.status, 409);
    r = await request('POST', '/api/capas/' + encodeURIComponent(arcCapa) + '/restore', undefined, adminToken);
    eq('POST /api/capas/:id/restore -> 200', r.status, 200);
    r = await request('GET', '/api/capas', undefined, adminToken);
    const restCapa = (r.body || []).find((c) => c.id === arcCapa);
    ok('restored CAPA back in list without archive fields', !!restCapa && !restCapa.archived && !restCapa.archivedBy, JSON.stringify(restCapa && { a: restCapa.archived }));
    r = await request('POST', '/api/capas/' + encodeURIComponent(arcCapa) + '/restore', undefined, adminToken);
    eq('restore a non-archived CAPA -> 409', r.status, 409);

    // 27c. NCR archive (same semantics; promote is blocked while archived)
    r = await request('POST', '/api/ncrs', { description: 'Arch NCR ' + PID, disposition: 'Rework' }, adminToken);
    const arcNcr = r.body && r.body.id;
    r = await request('DELETE', '/api/ncrs/' + encodeURIComponent(arcNcr), undefined, officerToken);
    eq('non-manager DELETE ncr -> 403', r.status, 403);
    r = await request('DELETE', '/api/ncrs/' + encodeURIComponent(arcNcr), undefined, adminToken);
    eq('DELETE /api/ncrs/:id (archive) -> 200', r.status, 200);
    r = await request('GET', '/api/ncrs', undefined, adminToken);
    ok('archived NCR hidden from default list', !(r.body || []).some((n) => n.id === arcNcr), arcNcr);
    r = await request('GET', '/api/ncrs?archived=1', undefined, adminToken);
    ok('archived NCR listed via ?archived=1', (r.body || []).some((n) => n.id === arcNcr && n.archived === true), JSON.stringify(r.body && r.body.length));
    r = await request('POST', '/api/ncrs/' + encodeURIComponent(arcNcr) + '/capa', undefined, adminToken);
    eq('promote archived NCR -> 409', r.status, 409);
    r = await request('PUT', '/api/ncrs/' + encodeURIComponent(arcNcr), { description: 'nope' }, adminToken);
    eq('PUT archived NCR -> 409', r.status, 409);
    r = await request('POST', '/api/ncrs/' + encodeURIComponent(arcNcr) + '/restore', undefined, adminToken);
    eq('POST /api/ncrs/:id/restore -> 200', r.status, 200);
    r = await request('GET', '/api/ncrs', undefined, adminToken);
    ok('restored NCR back in default list', (r.body || []).some((n) => n.id === arcNcr && !n.archived), arcNcr);
    r = await request('POST', '/api/ncrs/' + encodeURIComponent(arcNcr) + '/restore', undefined, adminToken);
    eq('restore a non-archived NCR -> 409', r.status, 409);

    // 28. competency gating (opt-in)
    r = await request('GET', '/api/admin/users', undefined, adminToken);
    ok('users expose qualifiedStages', Array.isArray(r.body) && r.body.every((u) => Array.isArray(u.qualifiedStages)), JSON.stringify(r.body && r.body[0]));
    await request('PUT', '/api/masterdata', { competencyEnforced: true }, adminToken);
    const compU = 'comp' + PID;
    await request('POST', '/api/admin/users', { id: compU, name: 'Comp Officer', role: 'QA Officer', password: 'secret123', qualifiedStages: [1] }, adminToken);
    let cr = await request('POST', '/api/login', { username: compU, password: 'secret123' });
    const compTok = cr.body && cr.body.token;
    const cjob = 'COMP-' + PID;
    await request('POST', '/api/jobs', { jobNo: cjob, machine: 'Flexo450' }, adminToken);
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(cjob) + '/stage/1', { data: { _done: true, date: '2026-06-23', qaOfficer: 'Comp', proceed: 'Yes', materialType: 'BOPP' } }, compTok);
    eq('qualified stage-1 complete -> 200', r.status, 200);
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(cjob) + '/stage/3', { data: { _done: true, date: '2026-06-23', operatorName: 'Comp', startTime: '06:00', finishTime: '10:00' } }, compTok);
    eq('unqualified stage-3 complete -> 403', r.status, 403);
    r = await request('PUT', '/api/jobs/' + encodeURIComponent(cjob) + '/stage/3', { data: { _done: true, date: '2026-06-23', operatorName: 'Admin', startTime: '06:00', finishTime: '10:00' } }, adminToken);
    eq('admin bypass stage-3 -> 200', r.status, 200);
    await request('PUT', '/api/masterdata', { competencyEnforced: false }, adminToken);
    await request('DELETE', '/api/admin/users/' + encodeURIComponent(compU), undefined, adminToken);

    // 29. Excel workbook export (SpreadsheetML)
    r = await request('GET', '/api/export/workbook.xls', undefined, adminToken);
    eq('GET /api/export/workbook.xls -> 200', r.status, 200);
    ok('workbook is SpreadsheetML with Jobs + CAPAs sheets',
      typeof r.raw === 'string' && r.raw.indexOf('<Workbook') >= 0 && r.raw.indexOf('ss:Name="Jobs"') >= 0 && r.raw.indexOf('ss:Name="CAPAs"') >= 0,
      (r.raw || '').slice(0, 60));
    ok('workbook now includes Calibration History + Checklists sheets',
      typeof r.raw === 'string' && r.raw.indexOf('ss:Name="Calibration History"') >= 0 && r.raw.indexOf('ss:Name="Checklists"') >= 0, '');

    // 30. Checklists module (F-012 hygiene, two-person sign-off)
    r = await request('GET', '/api/checklist-defs', undefined, adminToken);
    eq('GET /api/checklist-defs -> 200', r.status, 200);
    const hyg = (r.body || []).find(d => d.code === 'F-012-G');
    ok('F-012-G hygiene checklist seeded with items', !!(hyg && (hyg.items || []).length >= 15), hyg ? ('items=' + (hyg.items || []).length) : 'missing');
    const gmp = (r.body || []).find(d => d.code === 'F-013B');
    ok('F-013B GMP checklist populated with sections + items', !!(gmp && (gmp.items || []).filter(i => i.header).length === 6 && (gmp.items || []).filter(i => !i.header).length >= 55),
      gmp ? ('sections=' + (gmp.items || []).filter(i => i.header).length + ' items=' + (gmp.items || []).filter(i => !i.header).length) : 'missing');
    const resp = (hyg.items || []).map(it => ({ itemKey: it.key, status: 'Yes' }));
    r = await request('POST', '/api/checklists', { defKey: hyg.id, date: '2026-07-09', completedByName: 'Admin', responses: resp, status: 'Completed' }, adminToken);
    eq('POST /api/checklists (completed) -> 200', r.status, 200);
    const chkId = r.body && r.body.id;
    ok('checklist created with Completed status', !!(r.body && r.body.status === 'Completed'), (r.body || {}).status);
    r = await request('POST', '/api/checklists', { defKey: hyg.id, date: '2026-07-09', completedByName: 'Admin', responses: [], status: 'Completed' }, adminToken);
    eq('complete checklist with unanswered items -> 400', r.status, 400);
    r = await request('POST', '/api/checklists/' + encodeURIComponent(chkId) + '/verify', {}, adminToken);
    eq('verify by same user who completed -> 403 (two-person)', r.status, 403);
    r = await request('POST', '/api/login', { username: 'rprasad', password: 'prasad123' });
    const supTok = r.body && r.body.token;
    r = await request('POST', '/api/checklists/' + encodeURIComponent(chkId) + '/verify', {}, supTok);
    eq('verify by a second manager -> 200', r.status, 200);
    ok('checklist now Verified with verifier recorded', !!(r.body && r.body.status === 'Verified' && r.body.verifiedBy), (r.body || {}).status);
    r = await request('POST', '/api/checklist-defs', { code: 'X', title: 'Nope' }, officerToken);
    eq('create checklist-def by non-manager -> 403', r.status, 403);

    // 30b. Checklist photos — only server-issued /uploads/ URLs are accepted (drops foreign/traversal URLs)
    const photoResp = (hyg.items || []).slice(0, 2).map((it, i) => ({ itemKey: it.key, status: 'Yes', photos: i === 0 ? ['/uploads/item-shot.jpg', 'http://evil.example/x.jpg'] : [] }));
    r = await request('POST', '/api/checklists', { defKey: hyg.id, date: '2026-07-08', completedByName: 'Admin', status: 'Draft', responses: photoResp, photos: ['/uploads/floor-a.jpg', '/uploads/floor-b.jpg', 'https://evil.example/steal.jpg', '/uploads/../../etc/passwd'] }, adminToken);
    eq('POST checklist with photos (draft) -> 200', r.status, 200);
    const photoChk = r.body || {};
    ok('submission-level photos filtered to valid /uploads/ URLs only', Array.isArray(photoChk.photos) && photoChk.photos.length === 2 && photoChk.photos.every(u => /^\/uploads\/[\w.\-]+$/.test(u)), JSON.stringify(photoChk.photos));
    const itemWithPhoto = (photoChk.responses || []).find(x => (x.photos || []).length);
    ok('per-item photo kept and foreign URL dropped', !!(itemWithPhoto && itemWithPhoto.photos.length === 1 && itemWithPhoto.photos[0] === '/uploads/item-shot.jpg'), JSON.stringify(itemWithPhoto && itemWithPhoto.photos));

    // 30c. Due-tracking — GET /api/checklists/due reflects frequency + status; completing today marks it done
    r = await request('GET', '/api/checklists/due', undefined, adminToken);
    eq('GET /api/checklists/due -> 200', r.status, 200);
    const due = r.body || [];
    ok('due list is an array with a status per active form', Array.isArray(due) && due.length >= 2 && due.every(d => typeof d.status === 'string' && d.code), JSON.stringify(due).slice(0, 200));
    const hygDue = due.find(d => d.code === 'F-012-G');
    ok('F-012-G reports as a daily check', !!(hygDue && hygDue.frequency === 'daily'), JSON.stringify(hygDue));
    const gmpDue = due.find(d => d.code === 'F-013B');
    ok('F-013B reports as a monthly check', !!(gmpDue && gmpDue.frequency === 'monthly'), JSON.stringify(gmpDue));
    // Complete today's hygiene check (omit date so the server stamps its own plant-local today),
    // then it should read back as done for today. This also exercises the instant-email path.
    const respToday = (hyg.items || []).map(it => ({ itemKey: it.key, status: 'Yes' }));
    r = await request('POST', '/api/checklists', { defKey: hyg.id, completedByName: 'Admin', responses: respToday, status: 'Completed' }, adminToken);
    eq('complete today\'s hygiene check -> 200 (email path exercised, no error)', r.status, 200);
    r = await request('GET', '/api/checklists/due', undefined, adminToken);
    const hygDue2 = (r.body || []).find(d => d.code === 'F-012-G');
    ok('F-012-G marked done after today\'s completion', !!(hygDue2 && hygDue2.status === 'done'), JSON.stringify(hygDue2));
    r = await request('GET', '/api/checklists/due');
    eq('due list requires auth -> 401', r.status, 401);

    // 30d. Non-daily/non-monthly cadences must NOT be treated as daily (no false "overdue" reminder spam)
    r = await request('POST', '/api/checklist-defs', { code: 'F-WK1', title: 'Weekly line audit', frequency: 'weekly', items: [{ label: 'Line clean' }] }, adminToken);
    eq('create weekly checklist-def -> 200', r.status, 200);
    const wkId = r.body && r.body.id;
    r = await request('POST', '/api/checklist-defs', { code: 'F-AH1', title: 'Ad-hoc incident check', frequency: 'ad-hoc', items: [{ label: 'Area safe' }] }, adminToken);
    eq('create ad-hoc checklist-def -> 200', r.status, 200);
    const ahId = r.body && r.body.id;
    r = await request('GET', '/api/checklists/due', undefined, adminToken);
    const wkDue = (r.body || []).find(d => d.code === 'F-WK1');
    ok('weekly form reports frequency=weekly (not daily) and is never overdue', !!(wkDue && wkDue.frequency === 'weekly' && wkDue.status !== 'overdue'), JSON.stringify(wkDue));
    const ahDue = (r.body || []).find(d => d.code === 'F-AH1');
    ok('ad-hoc form is scheduled-only (never due/overdue → no reminder spam)', !!(ahDue && ahDue.frequency === 'ad-hoc' && ahDue.status === 'scheduled'), JSON.stringify(ahDue));
    // clean up the throwaway defs so later assertions/counts are unaffected
    if (wkId) await request('DELETE', '/api/checklist-defs/' + encodeURIComponent(wkId), undefined, adminToken);
    if (ahId) await request('DELETE', '/api/checklist-defs/' + encodeURIComponent(ahId), undefined, adminToken);

    // 30e. Checklist submission archive (DELETE = soft archive; re-arms due status; restorable)
    r = await request('POST', '/api/checklist-defs', { code: 'F-ARC1', title: 'Archive test daily', frequency: 'daily', items: [{ label: 'Thing done' }] }, adminToken);
    const arcDef = r.body; const arcDefId = arcDef && arcDef.id;
    const arcResp = (arcDef.items || []).map((it) => ({ itemKey: it.key, status: 'Yes' }));
    r = await request('POST', '/api/checklists', { defKey: arcDefId, completedByName: 'Admin', responses: arcResp, status: 'Completed' }, adminToken);
    eq('complete archive-test checklist -> 200', r.status, 200);
    const arcChk = r.body && r.body.id;
    r = await request('GET', '/api/checklists/due', undefined, adminToken);
    ok('archive-test form done after completion', ((r.body || []).find((d) => d.code === 'F-ARC1') || {}).status === 'done', JSON.stringify((r.body || []).find((d) => d.code === 'F-ARC1')));
    r = await request('DELETE', '/api/checklists/' + encodeURIComponent(arcChk), undefined, officerToken);
    eq('non-manager DELETE checklist -> 403', r.status, 403);
    r = await request('DELETE', '/api/checklists/' + encodeURIComponent(arcChk), undefined, adminToken);
    eq('DELETE /api/checklists/:id (archive) -> 200', r.status, 200);
    r = await request('GET', '/api/checklists', undefined, adminToken);
    ok('archived checklist hidden from default list', !(r.body || []).some((c) => c.id === arcChk), arcChk);
    r = await request('GET', '/api/checklists?archived=1', undefined, adminToken);
    ok('archived checklist listed via ?archived=1', (r.body || []).some((c) => c.id === arcChk && c.archived === true && c.archivedBy === 'admin'), JSON.stringify(r.body && r.body.length));
    r = await request('GET', '/api/checklists/due', undefined, adminToken);
    ok('archiving the submission re-arms the form as due', ((r.body || []).find((d) => d.code === 'F-ARC1') || {}).status !== 'done', JSON.stringify((r.body || []).find((d) => d.code === 'F-ARC1')));
    r = await request('GET', '/api/checklists/' + encodeURIComponent(arcChk), undefined, adminToken);
    eq('GET archived checklist by id still 200 (View stays open)', r.status, 200);
    r = await request('POST', '/api/checklists/' + encodeURIComponent(arcChk) + '/verify', {}, adminToken);
    eq('verify archived checklist -> 409', r.status, 409);
    r = await request('PUT', '/api/checklists/' + encodeURIComponent(arcChk), { comments: 'nope' }, adminToken);
    eq('PUT archived checklist -> 409', r.status, 409);
    r = await request('DELETE', '/api/checklists/' + encodeURIComponent(arcChk), undefined, adminToken);
    eq('archive an archived checklist -> 409', r.status, 409);
    r = await request('POST', '/api/checklists/' + encodeURIComponent(arcChk) + '/restore', undefined, officerToken);
    eq('non-manager restore checklist -> 403', r.status, 403);
    r = await request('POST', '/api/checklists/' + encodeURIComponent(arcChk) + '/restore', undefined, adminToken);
    eq('POST /api/checklists/:id/restore -> 200', r.status, 200);
    r = await request('GET', '/api/checklists/due', undefined, adminToken);
    ok('restored submission counts as done again', ((r.body || []).find((d) => d.code === 'F-ARC1') || {}).status === 'done', JSON.stringify((r.body || []).find((d) => d.code === 'F-ARC1')));
    r = await request('POST', '/api/checklists/' + encodeURIComponent(arcChk) + '/restore', undefined, adminToken);
    eq('restore a non-archived checklist -> 409', r.status, 409);
    if (arcDefId) await request('DELETE', '/api/checklist-defs/' + encodeURIComponent(arcDefId), undefined, adminToken);

    // 31. Calibration recording form + extractable history
    r = await request('GET', '/api/equipment', undefined, adminToken);
    const eq0 = (r.body || [])[0];
    ok('equipment seeded', !!eq0, 'none');
    r = await request('POST', '/api/equipment/' + encodeURIComponent(eq0.id) + '/calibrate',
      { on: '2026-07-09', result: 'Pass', technician: 'A. Kumar', sticker: 'Yes', registerUpdated: true, nextDue: '2027-07-09', readings: [{ reference: '10', machineOutput: '10.01' }, { reference: '20', machineOutput: '19.98' }] }, adminToken);
    eq('record calibration with readings -> 200', r.status, 200);
    r = await request('GET', '/api/equipment/' + encodeURIComponent(eq0.id) + '/history', undefined, adminToken);
    eq('GET equipment calibration history -> 200', r.status, 200);
    ok('history captures the 2 readings', !!(r.body && r.body.history && r.body.history[0] && (r.body.history[0].readings || []).length === 2), JSON.stringify(r.body && r.body.history && r.body.history[0] && r.body.history[0].readings));
    r = await request('GET', '/api/equipment/calibration-history.csv', undefined, adminToken);
    eq('calibration-history.csv -> 200', r.status, 200);
    ok('calibration CSV non-empty with Technician column', typeof r.raw === 'string' && r.raw.indexOf('Technician') >= 0 && r.raw.split('\n').length > 1, (r.raw || '').slice(0, 50));

    // 32. Amendments History (field-level before -> after)
    r = await request('GET', '/api/capas', undefined, adminToken);
    const capa0 = (r.body || [])[0];
    ok('a CAPA exists to amend', !!capa0, 'none');
    await request('PUT', '/api/capas/' + encodeURIComponent(capa0.id), { owner: 'zzz-newowner', severity: 'High' }, adminToken);
    r = await request('GET', '/api/audit?recordId=' + encodeURIComponent(capa0.id), undefined, adminToken);
    const withChg = (r.body || []).find(e => e.changes && e.changes.some(c => c.field === 'owner'));
    ok('amendment captured owner change (from -> to)', !!(withChg && withChg.changes.some(c => c.field === 'owner' && c.to === 'zzz-newowner')), JSON.stringify(withChg && withChg.changes));
    r = await request('GET', '/api/audit/export.csv', undefined, adminToken);
    eq('amendments export.csv -> 200', r.status, 200);
    ok('amendments CSV has From/To columns', typeof r.raw === 'string' && r.raw.indexOf('From') >= 0 && r.raw.indexOf('To') >= 0, (r.raw || '').slice(0, 80));

    // 33. jobs CSV no longer carries the removed Stage 2 (Reel Inspection) column
    r = await request('GET', '/api/export/jobs.csv', undefined, adminToken);
    eq('jobs export.csv -> 200', r.status, 200);
    ok('jobs CSV has no S2 Date column', typeof r.raw === 'string' && r.raw.indexOf('S2 Date') < 0 && r.raw.indexOf('S3 Date') >= 0, (r.raw || '').slice(0, 120));
    r = await request('GET', '/api/audit', undefined, officerToken);
    eq('audit read by non-manager -> 403', r.status, 403);
    r = await request('GET', '/api/audit/verify', undefined, adminToken);
    ok('audit chain still intact after v2 (field-level) entries', !!(r.body && r.body.ok === true), JSON.stringify(r.body));

  } catch (e) {
    failed++;
    console.log('FAIL  unexpected error during run -> ' + (e && e.stack ? e.stack : e));
  } finally {
    // ALWAYS kill the child and restore the dev DB.
    try {
      if (!childExited) {
        child.kill('SIGTERM');
        // give it a moment, then force-kill if still alive
        const deadline = Date.now() + 3000;
        while (!childExited && Date.now() < deadline) await sleep(50);
        if (!childExited) child.kill('SIGKILL');
      }
    } catch (e) { /* ignore */ }
    cleanupDataDir();
  }

  console.log('');
  console.log('Smoke summary: ' + passed + ' passed, ' + failed + ' failed.');
}

main()
  .then(() => { process.exit(failed > 0 ? 1 : 0); })
  .catch((e) => {
    console.error('Fatal:', e && e.stack ? e.stack : e);
    // best-effort cleanup even on fatal path
    try { cleanupDataDir(); } catch (x) { /* ignore */ }
    process.exit(1);
  });
