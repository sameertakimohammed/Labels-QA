'use strict';
/* Golden Manufacturers - Starkist Label QA System (on-prem server). Storage: PostgreSQL (see db.js). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');   // legacy file: imported once if present (migration)
const UP_DIR = path.join(DATA_DIR, 'uploads');
const PUB = path.join(ROOT, 'public');
fs.mkdirSync(UP_DIR, { recursive: true });

const store = require('./db');
const BC = require('./integrations/businessCentral');
const NOTIFY = require('./integrations/notify');
const AVT = require('./integrations/avtImport');

/* ---------- crypto / user helpers ---------- */
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
function mkUser(id, name, role, pin) { const salt = crypto.randomBytes(6).toString('hex'); return { id, name, role, active: true, sso: false, salt, pinHash: hashPin(pin, salt) }; }

/* ---------- seed (used only if the database is empty; same shape as the legacy db.json) ---------- */
function seedDB() {
  return {
    users: [
      mkUser('akumar', 'A. Kumar', 'QA Officer', '1234'),
      mkUser('pdevi', 'P. Devi', 'QA Officer', '1234'),
      mkUser('rprasad', 'R. Prasad', 'Supervisor', '2345'),
      mkUser('ateet', 'Ateet Roshan', 'Quality Manager', '9999'),
      mkUser('admin', 'Administrator', 'Administrator', '0000')
    ],
    masterdata: {
      machines: {
        Flexo450: { form: 'F-040-A', label: 'Flexo 450', stations: ['Infeed','Station 1','Station 2','Station 3','Station 4','Station 5','Station 6','Station 7','Station 8','Station 9'] },
        NilPeter: { form: 'F-016-E', label: 'NilPeter', stations: ['Infeed','Station 1','Station 2','Station 3','Station 4','Station 5','Station 6','Station 7','Station 8'] },
        BOBST: { form: 'F-027-A', label: 'BOBST (Lamination)', stations: ['Infeed','Station 1','Station 2','Station 3','Station 4','Station 5','Station 6'] }
      },
      defectTypes: ['Hickey','Mis-register','Ink splash','Bubble','Streak','Scratch','Colour variation','Die-cut error','Lamination defect','Foreign matter'],
      products: ['Chunk Light Tuna 142g Wrap Label','Solid White Albacore 198g Label','Chunk Light 85g Wrap Label'],
      tolerances: CFG.tolerances
    },
    jobs: seedJobs()
  };
}
function seedJobs() {
  return [
    { jobNo:'SK-24817', customer:'StarKist', product:'Chunk Light Tuna 142g Wrap Label', machine:'Flexo450', description:'5-colour wrap, UV varnish', created:'2026-06-18',
      stage1:{_done:true,date:'2026-06-18',productDescription:'Chunk Light Tuna 142g',operator:'J. Naidu',supervisor:'R. Prasad',qaOfficer:'A. Kumar',proceed:'Yes',materialType:'BOPP White 60um',thicknessGrammage:'60um / 58 gsm',batchDetails:'BP-2261',dyneLevel:'38',supplier:'Innovia',substrate:'BOPP',machineSpeed:'120',gs1Barcode:'A',printRegistration:'0.1',cofFilmMetal:'0.28',stations:[{name:'Station 1',uv:'100%',anilox:'360',teeth:'120',ink:'Cyan',batch:'C-8841',by:'JN'},{name:'Station 2',uv:'100%',anilox:'360',teeth:'120',ink:'Magenta',batch:'M-8842',by:'JN'}],comments:'Within spec.',photos:[]},
      stage2:{_done:true,date:'2026-06-18',machineName:'AVT Inspection Machine 1',shift:'Day',operator:'S. Lal',qaOfficer:'A. Kumar',avtRef:'AVT-24817-01',rows:[{roll:'1',totalMeters:'5000',wasteIn:'40',wasteOut:'35',defect:'Hickey',weightKg:'1.1',sign:'SL'},{roll:'2',totalMeters:'5000',wasteIn:'30',wasteOut:'28',defect:'Mis-register',weightKg:'1.0',sign:'SL'}],remarks:'Cleared.',photos:[]},
      stage3:{_done:true,date:'2026-06-19',customerItem:'StarKist / 142g Wrap',startTime:'06:10',finishTime:'10:40',operatorName:'M. Singh',rolls:[{no:'1',material:'BOPP 60um',reelWidth:'330',size:'105x148',gsm:'58',repeat:'148',totalSheets:'4200',wasteKg:'1.2',goodSheets:'4120'}],colours:'Pass',register:'Pass',barcode:'A',cuttingAccuracy:'0.2',setupHours:'0.5',dtMechanical:'0.1',operatorRemarks:'Smooth',qcRemarks:'OK',photos:[]},
      stage4:{_done:false} },
    { jobNo:'SK-24820', customer:'StarKist', product:'Solid White Albacore 198g Label', machine:'NilPeter', description:'4-colour + cold foil', created:'2026-06-19',
      stage1:{_done:true,date:'2026-06-19',productDescription:'Albacore 198g',operator:'V. Reddy',supervisor:'R. Prasad',qaOfficer:'P. Devi',proceed:'Yes',materialType:'Paper 80gsm',gs1Barcode:'A',printRegistration:'0.1',stations:[{name:'Station 1',uv:'100%',anilox:'360',teeth:'110',ink:'Cyan',batch:'C-9001',by:'VR'}],comments:'Cold foil aligned.',photos:[]},
      stage2:{_done:false}, stage3:{_done:false}, stage4:{_done:false} },
    { jobNo:'SK-24795', customer:'StarKist', product:'Chunk Light 85g Wrap Label', machine:'BOBST', description:'Laminated wrap', created:'2026-06-15',
      stage1:{_done:true,date:'2026-06-15',operator:'A. Chand',qaOfficer:'A. Kumar',proceed:'Yes',materialType:'BOPP/Foil laminate',gs1Barcode:'A',cofFilmMetal:'0.30',stations:[{name:'Station 1',uv:'100%',anilox:'320',teeth:'130',ink:'Adhesive',batch:'AD-220',by:'AC'}],comments:'Bond OK.',photos:[]},
      stage2:{_done:true,date:'2026-06-15',machineName:'AVT Inspection Machine 1',shift:'Day',operator:'S. Lal',qaOfficer:'A. Kumar',avtRef:'AVT-24795-01',rows:[{roll:'1',totalMeters:'6000',wasteIn:'25',wasteOut:'20',defect:'Bubble',weightKg:'1.0',sign:'SL'}],remarks:'Cleared.',photos:[]},
      stage3:{_done:true,date:'2026-06-16',customerItem:'StarKist / 85g Wrap',startTime:'07:00',finishTime:'11:15',operatorName:'M. Singh',rolls:[{no:'1',material:'Laminate',reelWidth:'300',size:'95x130',gsm:'-',repeat:'130',totalSheets:'5200',wasteKg:'1.5',goodSheets:'5100'}],colours:'Pass',register:'Pass',barcode:'A',cuttingAccuracy:'0.2',setupHours:'0.4',operatorRemarks:'OK',qcRemarks:'OK',photos:[]},
      stage4:{_done:true,date:'2026-06-16',productItem:'Chunk Light 85g Wrap',labelWidth:'95',labelLength:'130',shift:'Day',shiftStartFinish:'07:00 - 15:00',checks:[{time:'08:00',vals:{'Banded Bundle Checked':'Yes','Shrink-Wrapped Bundle Checked':'Yes','Packing Label Checked':'Yes','Finished Good Pallet Checked':'Yes','Label Orientation in Bundle':'Yes','Line Clearance Status':'Yes','Curling':'No','Printing Defects':'No','Cutting Defects':'No'}}],rejectedQty:'0',reasonsRejection:'-',remarks:'All checks passed.',operatorName:'R. Kumar',qcName:'A. Kumar',packersNames:'Team B',statusFinal:'Released',photos:[]},
      statusOverride:'Released' }
  ];
}

/* ---------- sessions (durable in Postgres, cached in-memory for fast auth) ---------- */
const SESS_TTL = (((CFG.auth && CFG.auth.sessionTtlMinutes) || 720) * 60000);
let SESS = {};
function newToken() { return crypto.randomBytes(16).toString('hex'); }
async function pruneSess() { const cut = Date.now() - SESS_TTL; let changed = false; for (const t in SESS) { if ((SESS[t].ts || 0) < cut) { delete SESS[t]; changed = true; } } if (changed) { try { await store.pruneSessions(cut); } catch (e) {} } }
async function userByToken(req) {
  const t = (req.headers['authorization'] || '').replace(/^Bearer /, '') || req.headers['x-token'];
  const s = t && SESS[t]; if (!s) return null;
  if (Date.now() - (s.ts || 0) > SESS_TTL) { delete SESS[t]; store.deleteSession(t).catch(() => {}); return null; }
  s.ts = Date.now(); // sliding window (persisted on login/logout/prune, not every request)
  const u = await store.findUser(s.userId);
  if (!u || u.active === false) { delete SESS[t]; store.deleteSession(t).catch(() => {}); return null; }
  return u;
}
function isRole(user, roles) { return !!user && roles.includes(user.role); }
function audit(user, action, jobNo, detail) { store.addAudit(user ? user.id : 'anon', action, jobNo || '', detail || '').catch(() => {}); }

/* ---------- stage validation: in-sequence completion + minimum required fields ---------- */
function stageSequenceError(j, n) { for (let k = 1; k < n; k++) { if (!(j['stage' + k] && j['stage' + k]._done)) return 'Complete Stage ' + k + ' before completing Stage ' + n + '.'; } return null; }
function stageRequiredError(n, d) {
  const blank = v => (v === undefined || v === null || String(v).trim() === ''); const miss = [];
  const req = pairs => pairs.forEach(p => { if (blank(d[p[1]])) miss.push(p[0]); });
  if (n === 1) { req([['Date','date'],['Proceed With Job','proceed'],['QA Officer','qaOfficer']]); }
  else if (n === 2) { req([['Date','date'],['QA Officer','qaOfficer']]); if (!(d.rows || []).some(r => r && (String(r.totalMeters || '').trim() || String(r.defect || '').trim()))) miss.push('at least one reel/defect row'); }
  else if (n === 3) { req([['Date','date'],['Operator','operatorName']]); if (!(d.rolls || []).some(r => r && String(r.no || '').trim())) miss.push('at least one roll'); }
  else if (n === 4) { req([['Date','date'],['Final Release Decision','statusFinal'],['QC Name','qcName']]); if (!(d.checks || []).some(c => c && String(c.time || '').trim())) miss.push('at least one hourly check'); }
  return miss.length ? ('Missing required: ' + miss.join(', ')) : null;
}

/* ---------- http helpers ---------- */
function send(res, code, obj, headers) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': typeof obj === 'string' ? 'text/plain' : 'application/json', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon' };
function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}
function readBody(req) { return new Promise((resolve) => { let d = ''; req.on('data', c => { d += c; if (d.length > 25 * 1024 * 1024) req.destroy(); }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } }); }); }
function pubUser(u) { return { id: u.id, name: u.name, role: u.role }; }

/* ---------- SSO ---------- */
async function verifySso(b) {
  const mode = (CFG.sso && CFG.sso.mode) || 'stub';
  if (mode === 'entra') { const p = await verifyEntraToken(b.idToken || b.accessToken); return p ? await ssoProfileToUser(p) : null; }
  const email = b && b.email; if (!email) return null;
  const dom = '@' + CFG.sso.allowedDomain; if (!String(email).toLowerCase().endsWith(dom)) return null;
  return await ssoProfileToUser({ id: String(email).split('@')[0].toLowerCase(), name: email.split('@')[0], role: 'Quality Manager', email });
}
async function ssoProfileToUser(p) { if (!p || !p.id) return null;
  let u = await store.findUser(p.id);
  if (!u) { u = { id: p.id, name: p.name || p.id, role: p.role || 'QA Officer', active: true, sso: true, salt: null, pinHash: null }; await store.createUser(u); audit(null, 'provision-sso-user', '', p.id); }
  return u;
}
/* SCAFFOLD — Microsoft Entra ID token validation. To enable in production:
     1) set sso.mode='entra' and fill sso.tenantId / sso.clientId in config.json;
     2) validate the JWT signature against the tenant JWKS
        (https://login.microsoftonline.com/<tenantId>/discovery/v2.0/keys);
     3) verify claims iss/aud/exp/tid; 4) return { id, name, role, email }.
   Use a vetted JWT/JWKS library. Until implemented this rejects all logins so an
   enabled-but-unconfigured 'entra' mode never silently trusts a token. */
async function verifyEntraToken(token) { if (!token) return null;
  console.warn('SSO mode=entra but verifyEntraToken() is not implemented yet — rejecting login. See scaffold in server.js.');
  return null;
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean).slice(1); // drop 'api'
  const method = req.method;

  if (seg[0] === 'health') return send(res, 200, { ok: true, org: CFG.orgName, time: new Date().toISOString() });

  if (seg[0] === 'login' && method === 'POST') {
    const b = await readBody(req);
    if (b.mode === 'sso') {
      const u = await verifySso(b); if (!u) return send(res, 401, { error: 'SSO not recognised' });
      if (u.active === false) return send(res, 403, { error: 'Account disabled' });
      const t = newToken(); SESS[t] = { userId: u.id, ts: Date.now() }; await store.saveSession(t, u.id, SESS[t].ts); audit(u, 'login-sso'); return send(res, 200, { token: t, user: pubUser(u) });
    }
    const u = await store.findUser(b.userId);
    if (!u || !u.pinHash || u.pinHash !== hashPin(String(b.pin || ''), u.salt)) return send(res, 401, { error: 'Invalid user or PIN' });
    if (u.active === false) return send(res, 403, { error: 'Account disabled' });
    const t = newToken(); SESS[t] = { userId: u.id, ts: Date.now() }; await store.saveSession(t, u.id, SESS[t].ts); audit(u, 'login'); return send(res, 200, { token: t, user: pubUser(u) });
  }
  if (seg[0] === 'users' && method === 'GET' && !seg[1]) return send(res, 200, await store.loginPickerUsers());

  const user = await userByToken(req);
  if (!user) return send(res, 401, { error: 'Not authenticated' });

  if (seg[0] === 'me') return send(res, 200, { user: pubUser(user) });
  if (seg[0] === 'logout' && method === 'POST') { const t = (req.headers['authorization'] || '').replace(/^Bearer /, '') || req.headers['x-token']; if (t && SESS[t]) { delete SESS[t]; await store.deleteSession(t); } audit(user, 'logout'); return send(res, 200, { ok: true }); }

  if (seg[0] === 'jobs' && method === 'GET' && !seg[1]) return send(res, 200, await store.listJobs());
  if (seg[0] === 'jobs' && method === 'GET' && seg[1]) { const j = await store.getJob(decodeURIComponent(seg[1])); return j ? send(res, 200, j) : send(res, 404, { error: 'Job not found' }); }
  if (seg[0] === 'jobs' && method === 'POST') {
    const b = await readBody(req); if (!b.jobNo || !b.machine) return send(res, 400, { error: 'jobNo and machine required' });
    if (await store.getJob(b.jobNo)) return send(res, 409, { error: 'Job already exists' });
    const job = { jobNo: b.jobNo, machine: b.machine, customer: b.customer || 'StarKist', product: b.product || '', description: b.description || '', created: new Date().toISOString().slice(0, 10) };
    await store.createJob(job); audit(user, 'create-job', job.jobNo); return send(res, 200, await store.getJob(job.jobNo));
  }
  if (seg[0] === 'jobs' && seg[2] === 'stage' && method === 'PUT') {
    const jobNo = decodeURIComponent(seg[1]); const j = await store.getJob(jobNo); if (!j) return send(res, 404, { error: 'Job not found' });
    const n = seg[3]; const b = await readBody(req); const data = b.data || {};
    if (data._done) { const se = stageSequenceError(j, +n); if (se) return send(res, 400, { error: se }); const re = stageRequiredError(+n, data); if (re) return send(res, 400, { error: re }); }
    await store.saveStage(j.jobNo, +n, data);
    if (n === '4' && data._done && data.statusFinal) { const st = data.statusFinal === 'Released' ? 'Released' : (data.statusFinal === 'Rejected' ? 'Rejected' : 'Hold'); await store.setStatusOverride(j.jobNo, st); if (st !== 'Released') NOTIFY.alert(CFG, 'Job ' + j.jobNo + ' set to ' + st, 'Stage 4 decision: ' + data.statusFinal + ' (qty ' + (data.rejectedQty || '?') + ')'); }
    audit(user, 'save-stage' + n, j.jobNo, data._done ? 'completed' : 'draft'); return send(res, 200, await store.getJob(j.jobNo));
  }
  if (seg[0] === 'jobs' && seg[2] === 'hold' && method === 'POST') {
    const jobNo = decodeURIComponent(seg[1]); const j = await store.getJob(jobNo); if (!j) return send(res, 404, { error: 'Job not found' });
    const b = await readBody(req); await store.setStatusOverride(j.jobNo, 'Hold'); audit(user, 'hold', j.jobNo, b.reason || ''); NOTIFY.alert(CFG, 'Job ' + j.jobNo + ' placed on HOLD', (b.reason || '') + ' by ' + user.name); return send(res, 200, await store.getJob(j.jobNo));
  }

  if (seg[0] === 'upload' && method === 'POST') {
    const b = await readBody(req); const m = /^data:(image\/\w+);base64,(.+)$/.exec(b.dataUrl || '');
    if (!m) return send(res, 400, { error: 'Invalid image data' });
    const ext = m[1] === 'image/png' ? '.png' : '.jpg'; const fn = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
    fs.writeFileSync(path.join(UP_DIR, fn), Buffer.from(m[2], 'base64')); audit(user, 'upload-photo', '', fn);
    return send(res, 200, { url: '/uploads/' + fn });
  }

  if (seg[0] === 'masterdata' && method === 'GET') return send(res, 200, await store.getMasterdata());
  if (seg[0] === 'masterdata' && method === 'PUT') { const b = await readBody(req); const md = await store.updateMasterdata(b); audit(user, 'update-masterdata'); return send(res, 200, md); }

  /* ---- user management (Administrator only) ---- */
  if (seg[0] === 'admin' && seg[1] === 'users') {
    if (!isRole(user, ['Administrator'])) return send(res, 403, { error: 'Administrator access required' });
    const ROLES = ['QA Officer','Supervisor','Quality Manager','Administrator'];
    if (method === 'GET' && !seg[2]) return send(res, 200, await store.adminListUsers());
    if (method === 'POST' && !seg[2]) {
      const b = await readBody(req);
      const id = String(b.id || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (!id || !String(b.name || '').trim() || !b.role) return send(res, 400, { error: 'id, name and role are required' });
      if (!ROLES.includes(b.role)) return send(res, 400, { error: 'Invalid role' });
      if (!/^\d{4,8}$/.test(String(b.pin || ''))) return send(res, 400, { error: 'PIN must be 4–8 digits' });
      if (await store.findUser(id)) return send(res, 409, { error: 'User id already exists' });
      await store.createUser(mkUser(id, String(b.name).trim(), b.role, String(b.pin)));
      audit(user, 'create-user', '', id + ' (' + b.role + ')'); return send(res, 200, await store.adminGetUser(id));
    }
    const id = decodeURIComponent(seg[2] || ''); const target = await store.findUser(id);
    if (seg[2] && method === 'PUT') {
      if (!target) return send(res, 404, { error: 'User not found' }); const b = await readBody(req); const patch = {};
      if (b.name !== undefined && String(b.name).trim()) patch.name = String(b.name).trim();
      if (b.role !== undefined) { if (!ROLES.includes(b.role)) return send(res, 400, { error: 'Invalid role' });
        if (target.role === 'Administrator' && b.role !== 'Administrator' && (await store.countActiveAdmins()) <= 1) return send(res, 400, { error: 'Cannot demote the last administrator' }); patch.role = b.role; }
      if (b.active !== undefined) { const a = !!b.active;
        if (!a && target.id === user.id) return send(res, 400, { error: 'You cannot disable your own account' });
        if (!a && target.role === 'Administrator' && (await store.countActiveAdmins()) <= 1) return send(res, 400, { error: 'Cannot disable the last administrator' }); patch.active = a; }
      if (b.pin !== undefined && String(b.pin) !== '') { if (!/^\d{4,8}$/.test(String(b.pin))) return send(res, 400, { error: 'PIN must be 4–8 digits' }); const salt = crypto.randomBytes(6).toString('hex'); patch.salt = salt; patch.pinHash = hashPin(String(b.pin), salt); }
      await store.updateUser(id, patch);
      if (patch.active === false) { for (const t in SESS) { if (SESS[t].userId === id) delete SESS[t]; } await store.deleteSessionsForUser(id); }
      audit(user, 'update-user', '', id); return send(res, 200, await store.adminGetUser(id));
    }
    if (seg[2] && method === 'DELETE') {
      if (!target) return send(res, 404, { error: 'User not found' });
      if (target.id === user.id) return send(res, 400, { error: 'You cannot delete your own account' });
      if (target.role === 'Administrator' && (await store.countActiveAdmins()) <= 1) return send(res, 400, { error: 'Cannot delete the last administrator' });
      await store.deleteUser(id); for (const t in SESS) { if (SESS[t].userId === id) delete SESS[t]; }
      audit(user, 'delete-user', '', id); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Unknown user route' });
  }

  if (seg[0] === 'audit' && method === 'GET') return send(res, 200, await store.getAudit(300));

  if (seg[0] === 'bc' && seg[1] === 'job' && method === 'GET') { const r = await BC.lookupJob(CFG, decodeURIComponent(seg[2] || '')); return send(res, r.error ? 502 : 200, r); }

  if (seg[0] === 'avt-import' && method === 'POST') { const b = await readBody(req); const r = AVT.parse(b.csv || ''); return send(res, 200, r); }

  if (seg[0] === 'analytics' && method === 'GET') return send(res, 200, await store.analytics());

  if (seg[0] === 'export' && method === 'GET') {
    const cell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const toCsv = (headers, rows) => [headers].concat(rows).map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
    const csvRes = (name, csv) => send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + name + '"' });
    const md = await store.getMasterdata(); const mlabel = m => (md.machines[m] && md.machines[m].label) || m || '';
    if (seg[1] === 'jobs') { const jobs = await store.listJobs(); return csvRes('golden-qa-jobs.csv', toCsv(['Job #','Product','Customer','Machine','Created','Status','Stages Complete'], jobs.map(j => [j.jobNo, j.product, j.customer, mlabel(j.machine), j.created, j.status, j.completed]))); }
    if (seg[1] === 'defects') { const rows = await store.defectExportRows(); return csvRes('golden-qa-defects.csv', toCsv(['Job #','Machine','Roll','Defect','Total m','Waste In','Waste Out','Weight Kg'], rows.map(r => [r.jobNo, mlabel(r.machine), r.roll, r.defect, r.totalMeters, r.wasteIn, r.wasteOut, r.weightKg]))); }
    return send(res, 404, { error: 'Unknown export' });
  }

  return send(res, 404, { error: 'Unknown API route' });
}

/* ---------- HTTP server ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(e => { console.error(e); send(res, 500, { error: String(e && e.message || e) }); });
  if (url.pathname.startsWith('/uploads/')) return serveStatic(res, path.join(UP_DIR, path.basename(url.pathname)));
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(PUB, p));
  if (!filePath.startsWith(PUB)) return send(res, 403, 'Forbidden');
  fs.existsSync(filePath) ? serveStatic(res, filePath) : serveStatic(res, path.join(PUB, 'index.html'));
});

(async () => {
  const initialDoc = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : seedDB();
  await store.init(CFG, initialDoc);
  SESS = await store.loadSessions();
  setInterval(() => { pruneSess(); }, 3600000).unref(); // hourly expiry sweep
  const PORT = process.env.PORT || CFG.port;
  server.listen(PORT, CFG.host, () => console.log('Golden QA server on http://' + CFG.host + ':' + PORT + '  (' + CFG.orgName + ')  [PostgreSQL]'));
})().catch(e => { console.error('Startup failed:', e && e.message || e); process.exit(1); });

module.exports = { server };
