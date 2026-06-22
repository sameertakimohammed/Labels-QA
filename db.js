'use strict';
/* Golden QA — PostgreSQL data-access layer (fully normalized schema).
 *
 * Design: every entity is a real table. The four inspection stages are split
 * into a scalar header table (stageN) plus child tables for their repeating
 * rows (stations / reel rows / rolls / hourly checks) and a shared stage_photos
 * table. Column names are generated from the same camelCase field lists the API
 * already uses (snake_cased + quoted), so the schema and the read/write code
 * cannot drift apart. The store reassembles the exact nested job shape the
 * front-end expects, so the UI is unchanged. */
const { Pool } = require('pg');

let pool;
const q = (text, params) => pool.query(text, params);
const snake = c => c.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
const Q = id => '"' + id + '"';            // quote identifier (keyword-safe)
const col = c => Q(snake(c));

/* ---- field definitions (single source of truth for DDL + queries) ---- */
const STAGE = {
  1: { table: 'stage1',
       fields: ['date','productDescription','operator','supervisor','qaOfficer','proceed','materialType','thicknessGrammage','batchDetails','dyneLevel','supplier','substrate','machineSpeed','gs1Barcode','printRegistration','cofFilmMetal','cofFilmFilm','scotchTape','textColorLayout','printScuffing','tackSetoff','unwinderTension','infeedTension','rewindTension','outfeedTension','airPressure','chillerTemp','corona','comments'],
       children: [{ prop:'stations', table:'stage1_stations', fields:['name','uv','anilox','teeth','ink','batch','by'] }] },
  2: { table: 'stage2',
       fields: ['date','machineName','shift','operator','qaOfficer','avtRef','remarks'],
       children: [{ prop:'rows', table:'stage2_rows', fields:['roll','totalMeters','wasteIn','wasteOut','defect','weightKg','sign'] }] },
  3: { table: 'stage3',
       fields: ['date','customerItem','startTime','finishTime','operatorName','thickness','colours','register','copy','barcode','webTension','curling','cuttingAccuracy','setupHours','dtMaterial','dtWindup','dtDamage','dtMechanical','dtElectrical','dtOthers','operatorRemarks','qcRemarks'],
       children: [{ prop:'rolls', table:'stage3_rolls', fields:['no','material','reelWidth','size','gsm','repeat','totalSheets','wasteKg','goodSheets'] }] },
  4: { table: 'stage4',
       fields: ['date','productItem','shift','shiftStartFinish','labelWidth','labelLength','labelThickness','labelGauge','rejectedQty','reasonsRejection','remarks','operatorName','qcName','packersNames','statusFinal','signature'],
       children: [] }   // hourly checks handled via stage4_checks / stage4_check_values
};

/* ---- schema ---- */
function ddl() {
  const stmts = [
    `create table if not exists users(
       id text primary key, name text not null, role text not null,
       active boolean not null default true, sso boolean not null default false,
       salt text, pin_hash text)`,
    `create table if not exists machines(machine_key text primary key, label text not null, form_code text)`,
    `create table if not exists machine_stations(
       machine_key text not null references machines(machine_key) on delete cascade,
       position int not null, name text not null, primary key(machine_key, position))`,
    `create table if not exists defect_types(name text primary key, ord int)`,
    `create table if not exists products(name text primary key, ord int)`,
    `create table if not exists tolerances(
       one boolean primary key default true check (one),
       cof_min double precision, cof_max double precision,
       registration_max_mm double precision, barcode_min_grade text)`,
    `create table if not exists jobs(
       job_no text primary key, seq bigserial unique,
       customer text, product text, machine text, description text,
       created text, status_override text)`,
    `create table if not exists audit(
       id bigserial primary key, ts timestamptz not null default now(),
       user_id text, action text, job_no text, detail text)`,
    `create table if not exists sessions(
       token text primary key, user_id text references users(id) on delete cascade, ts bigint not null)`,
    `create table if not exists stage_photos(
       id bigserial primary key, job_no text not null references jobs(job_no) on delete cascade,
       stage int not null, position int not null, url text not null)`,
    `create table if not exists stage4_checks(
       id bigserial primary key, job_no text not null references jobs(job_no) on delete cascade,
       position int not null, "time" text)`,
    `create table if not exists stage4_check_values(
       check_id bigint not null references stage4_checks(id) on delete cascade,
       param text not null, value text, primary key(check_id, param))`
  ];
  // stage header + child tables, generated from STAGE field lists
  for (const n of [1,2,3,4]) {
    const cfg = STAGE[n];
    stmts.push(`create table if not exists ${Q(cfg.table)}(
      job_no text primary key references jobs(job_no) on delete cascade,
      done boolean not null default false${cfg.fields.length ? ',\n      ' + cfg.fields.map(f => col(f) + ' text').join(',\n      ') : ''})`);
    for (const ch of cfg.children) {
      stmts.push(`create table if not exists ${Q(ch.table)}(
        id bigserial primary key,
        job_no text not null references jobs(job_no) on delete cascade,
        position int not null,
        ${ch.fields.map(f => col(f) + ' text').join(',\n        ')})`);
    }
  }
  // helpful indexes for the normalized reporting queries
  stmts.push(`create index if not exists ix_stage2_rows_job on stage2_rows(job_no)`);
  stmts.push(`create index if not exists ix_stage3_rolls_job on stage3_rolls(job_no)`);
  stmts.push(`create index if not exists ix_audit_id on audit(id desc)`);
  return stmts;
}

/* ---- init / pool ---- */
function makePool(CFG) {
  const d = CFG.database || {};
  const url = process.env.DATABASE_URL || d.url;
  const ssl = d.ssl ? { rejectUnauthorized: false } : false;
  return url ? new Pool({ connectionString: url, ssl })
             : new Pool({ host: d.host || '127.0.0.1', port: d.port || 5432, database: d.database || 'goldenqa', user: d.user || 'postgres', password: d.password || undefined, ssl });
}
async function init(CFG, initialDoc) {
  pool = makePool(CFG);
  await pool.query('select 1');                 // fail fast if unreachable
  for (const s of ddl()) await pool.query(s);
  const { rows } = await pool.query('select count(*)::int c from users');
  if (rows[0].c === 0 && initialDoc) await importDocument(initialDoc);
}

/* ---- import (also serves as one-time migration from the legacy db.json) ---- */
async function importDocument(doc) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const u of (doc.users || []))
      await client.query('insert into users(id,name,role,active,sso,salt,pin_hash) values($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing',
        [u.id, u.name, u.role, u.active !== false, !!u.sso, u.salt || null, u.pinHash || null]);
    const md = doc.masterdata || {};
    for (const key of Object.keys(md.machines || {})) {
      const m = md.machines[key];
      await client.query('insert into machines(machine_key,label,form_code) values($1,$2,$3) on conflict (machine_key) do nothing', [key, m.label || key, m.form || null]);
      let pos = 0; for (const st of (m.stations || [])) await client.query('insert into machine_stations(machine_key,position,name) values($1,$2,$3) on conflict do nothing', [key, pos++, st]);
    }
    let i = 0; for (const dname of (md.defectTypes || [])) await client.query('insert into defect_types(name,ord) values($1,$2) on conflict (name) do nothing', [dname, i++]);
    i = 0; for (const pname of (md.products || [])) await client.query('insert into products(name,ord) values($1,$2) on conflict (name) do nothing', [pname, i++]);
    const t = md.tolerances || {};
    await client.query(`insert into tolerances(one,cof_min,cof_max,registration_max_mm,barcode_min_grade) values(true,$1,$2,$3,$4)
       on conflict (one) do update set cof_min=excluded.cof_min,cof_max=excluded.cof_max,registration_max_mm=excluded.registration_max_mm,barcode_min_grade=excluded.barcode_min_grade`,
      [t.cofMin ?? null, t.cofMax ?? null, t.registrationMaxMm ?? null, t.barcodeMinGrade ?? null]);
    for (const j of (doc.jobs || [])) {
      await insertJob(client, j);
      for (const n of [1,2,3,4]) { const sd = j['stage' + n]; if (sd) await writeStage(client, j.jobNo, n, sd); }
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
}

/* ---- jobs ---- */
async function insertJob(client, j) {
  await client.query('insert into jobs(job_no,customer,product,machine,description,created,status_override) values($1,$2,$3,$4,$5,$6,$7) on conflict (job_no) do nothing',
    [j.jobNo, j.customer || null, j.product || null, j.machine || null, j.description || null, j.created || null, j.statusOverride || null]);
}
async function createJob(j) { const c = await pool.connect(); try { await insertJob(c, j); } finally { c.release(); } }

async function writeStage(client, jobNo, n, data) {
  const cfg = STAGE[n];
  const cols = ['job_no', 'done', ...cfg.fields.map(snake)];
  const vals = [jobNo, !!data._done, ...cfg.fields.map(f => data[f] === undefined || data[f] === null ? null : String(data[f]))];
  const ph = cols.map((_, k) => '$' + (k + 1)).join(',');
  const upd = cols.slice(1).map(c => Q(c) + '=excluded.' + Q(c)).join(',');
  await client.query(`insert into ${Q(cfg.table)}(${cols.map(Q).join(',')}) values(${ph}) on conflict (job_no) do update set ${upd}`, vals);
  for (const ch of cfg.children) {
    await client.query(`delete from ${Q(ch.table)} where job_no=$1`, [jobNo]);
    const arr = Array.isArray(data[ch.prop]) ? data[ch.prop] : [];
    let pos = 0;
    for (const item of arr) {
      const ccols = ['job_no', 'position', ...ch.fields.map(snake)];
      const cvals = [jobNo, pos++, ...ch.fields.map(f => item[f] === undefined || item[f] === null ? null : String(item[f]))];
      await client.query(`insert into ${Q(ch.table)}(${ccols.map(Q).join(',')}) values(${ccols.map((_, k) => '$' + (k + 1)).join(',')})`, cvals);
    }
  }
  if (n === 4) {
    await client.query('delete from stage4_checks where job_no=$1', [jobNo]); // cascades check_values
    let pos = 0;
    for (const c of (Array.isArray(data.checks) ? data.checks : [])) {
      const ins = await client.query('insert into stage4_checks(job_no,position,"time") values($1,$2,$3) returning id', [jobNo, pos++, c.time === undefined ? null : String(c.time)]);
      const cid = ins.rows[0].id; const vals = c.vals || {};
      for (const p of Object.keys(vals)) await client.query('insert into stage4_check_values(check_id,param,value) values($1,$2,$3)', [cid, p, vals[p] == null ? null : String(vals[p])]);
    }
  }
  await client.query('delete from stage_photos where job_no=$1 and stage=$2', [jobNo, n]);
  let pp = 0;
  for (const u of (Array.isArray(data.photos) ? data.photos : [])) await client.query('insert into stage_photos(job_no,stage,position,url) values($1,$2,$3,$4)', [jobNo, n, pp++, String(u)]);
}
async function saveStage(jobNo, n, data) {
  const client = await pool.connect();
  try { await client.query('begin'); await writeStage(client, jobNo, n, data); await client.query('commit'); }
  catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
}
async function setStatusOverride(jobNo, status) { await q('update jobs set status_override=$2 where job_no=$1', [jobNo, status || null]); }

async function getStage(client, n, jobNo) {
  const cfg = STAGE[n];
  const r = await client.query(`select * from ${Q(cfg.table)} where job_no=$1`, [jobNo]);
  if (!r.rows.length) return { _done: false };
  const row = r.rows[0]; const obj = { _done: row.done };
  cfg.fields.forEach(f => { const v = row[snake(f)]; if (v !== null && v !== undefined) obj[f] = v; });
  for (const ch of cfg.children) {
    const cr = await client.query(`select * from ${Q(ch.table)} where job_no=$1 order by position`, [jobNo]);
    obj[ch.prop] = cr.rows.map(rr => { const o = {}; ch.fields.forEach(f => { o[f] = rr[snake(f)] == null ? '' : rr[snake(f)]; }); return o; });
  }
  if (n === 4) {
    const ck = await client.query('select id,position,"time" from stage4_checks where job_no=$1 order by position', [jobNo]);
    const checks = [];
    for (const c of ck.rows) {
      const vr = await client.query('select param,value from stage4_check_values where check_id=$1', [c.id]);
      const vals = {}; vr.rows.forEach(v => vals[v.param] = v.value); checks.push({ time: c.time || '', vals });
    }
    obj.checks = checks;
  }
  const ph = await client.query('select url from stage_photos where job_no=$1 and stage=$2 order by position', [jobNo, n]);
  obj.photos = ph.rows.map(p => p.url);
  return obj;
}
async function getJob(jobNo) {
  const client = await pool.connect();
  try {
    const jr = await client.query('select * from jobs where lower(job_no)=lower($1)', [jobNo]);
    if (!jr.rows.length) return null;
    const j = jr.rows[0];
    const job = { jobNo: j.job_no, customer: j.customer, product: j.product, machine: j.machine, description: j.description, created: j.created };
    if (j.status_override) job.statusOverride = j.status_override;
    for (const n of [1,2,3,4]) job['stage' + n] = await getStage(client, n, j.job_no);
    return job;
  } finally { client.release(); }
}
async function listJobs() {
  const r = await q(`select j.job_no,j.product,j.customer,j.machine,j.created,j.status_override,
      coalesce(s1.done,false) d1,coalesce(s2.done,false) d2,coalesce(s3.done,false) d3,coalesce(s4.done,false) d4
    from jobs j
    left join stage1 s1 on s1.job_no=j.job_no left join stage2 s2 on s2.job_no=j.job_no
    left join stage3 s3 on s3.job_no=j.job_no left join stage4 s4 on s4.job_no=j.job_no
    order by j.seq desc`);
  return r.rows.map(j => { const completed = [j.d1,j.d2,j.d3,j.d4].filter(Boolean).length;
    const status = j.status_override || (completed === 0 ? 'New' : (completed < 4 ? 'In Progress' : 'Released'));
    return { jobNo: j.job_no, product: j.product, customer: j.customer, machine: j.machine, created: j.created, status, completed }; });
}

/* ---- users ---- */
const rowToUser = r => r ? { id: r.id, name: r.name, role: r.role, active: r.active, sso: r.sso, salt: r.salt, pinHash: r.pin_hash } : null;
const rowToAdmin = r => ({ id: r.id, name: r.name, role: r.role, active: r.active !== false, sso: !!r.sso, hasPin: !!r.pin_hash });
async function findUser(id) { const r = await q('select * from users where id=$1', [id]); return rowToUser(r.rows[0]); }
async function loginPickerUsers() { const r = await q("select id,name,role from users where active and pin_hash is not null order by name"); return r.rows.map(u => ({ id: u.id, name: u.name, role: u.role })); }
async function adminListUsers() { const r = await q('select * from users order by name'); return r.rows.map(rowToAdmin); }
async function adminGetUser(id) { const r = await q('select * from users where id=$1', [id]); return r.rows[0] ? rowToAdmin(r.rows[0]) : null; }
async function createUser(u) { await q('insert into users(id,name,role,active,sso,salt,pin_hash) values($1,$2,$3,$4,$5,$6,$7)', [u.id, u.name, u.role, u.active !== false, !!u.sso, u.salt || null, u.pinHash || null]); return adminGetUser(u.id); }
async function updateUser(id, patch) {
  const map = { name: 'name', role: 'role', active: 'active', salt: 'salt', pinHash: 'pin_hash' };
  const sets = [], vals = []; let k = 1;
  for (const key of Object.keys(patch)) if (map[key]) { sets.push(Q(map[key]) + '=$' + (k++)); vals.push(patch[key]); }
  if (sets.length) { vals.push(id); await q('update users set ' + sets.join(',') + ' where id=$' + k, vals); }
  return adminGetUser(id);
}
async function deleteUser(id) { await q('delete from users where id=$1', [id]); }
async function countActiveAdmins() { const r = await q("select count(*)::int c from users where role='Administrator' and active"); return r.rows[0].c; }

/* ---- masterdata ---- */
async function getMasterdata() {
  const machines = {};
  const mr = await q('select machine_key,label,form_code from machines order by machine_key');
  for (const m of mr.rows) {
    const sr = await q('select name from machine_stations where machine_key=$1 order by position', [m.machine_key]);
    machines[m.machine_key] = { form: m.form_code, label: m.label, stations: sr.rows.map(s => s.name) };
  }
  const dr = await q('select name from defect_types order by ord nulls last, name');
  const pr = await q('select name from products order by ord nulls last, name');
  const tr = await q('select * from tolerances where one');
  const t = tr.rows[0] || {};
  return { machines, defectTypes: dr.rows.map(x => x.name), products: pr.rows.map(x => x.name),
    tolerances: { cofMin: t.cof_min, cofMax: t.cof_max, registrationMaxMm: t.registration_max_mm, barcodeMinGrade: t.barcode_min_grade } };
}
async function updateMasterdata(patch) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (patch.tolerances) { const t = patch.tolerances;
      await client.query(`insert into tolerances(one,cof_min,cof_max,registration_max_mm,barcode_min_grade) values(true,$1,$2,$3,$4)
        on conflict (one) do update set cof_min=excluded.cof_min,cof_max=excluded.cof_max,registration_max_mm=excluded.registration_max_mm,barcode_min_grade=excluded.barcode_min_grade`,
        [t.cofMin ?? null, t.cofMax ?? null, t.registrationMaxMm ?? null, t.barcodeMinGrade ?? null]); }
    if (Array.isArray(patch.defectTypes)) { await client.query('delete from defect_types'); let i = 0; for (const d of patch.defectTypes) await client.query('insert into defect_types(name,ord) values($1,$2) on conflict (name) do nothing', [d, i++]); }
    if (Array.isArray(patch.products)) { await client.query('delete from products'); let i = 0; for (const p of patch.products) await client.query('insert into products(name,ord) values($1,$2) on conflict (name) do nothing', [p, i++]); }
    if (patch.machines) { await client.query('delete from machines'); // cascades machine_stations
      for (const key of Object.keys(patch.machines)) { const m = patch.machines[key];
        await client.query('insert into machines(machine_key,label,form_code) values($1,$2,$3)', [key, m.label || key, m.form || null]);
        let pos = 0; for (const st of (m.stations || [])) await client.query('insert into machine_stations(machine_key,position,name) values($1,$2,$3)', [key, pos++, st]); } }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
  return getMasterdata();
}

/* ---- audit ---- */
async function addAudit(userId, action, jobNo, detail) { await q('insert into audit(user_id,action,job_no,detail) values($1,$2,$3,$4)', [userId || 'anon', action || '', jobNo || '', detail || '']); }
async function getAudit(limit) { const r = await q('select ts,user_id,action,job_no,detail from audit order by id desc limit $1', [limit || 300]);
  return r.rows.map(x => ({ ts: (x.ts instanceof Date ? x.ts.toISOString() : String(x.ts)), user: x.user_id, action: x.action, jobNo: x.job_no, detail: x.detail })); }

/* ---- sessions (durable; cached in-memory by the server) ---- */
async function loadSessions() { const r = await q('select token,user_id,ts from sessions'); const m = {}; r.rows.forEach(s => m[s.token] = { userId: s.user_id, ts: Number(s.ts) }); return m; }
async function saveSession(token, userId, ts) { await q('insert into sessions(token,user_id,ts) values($1,$2,$3) on conflict (token) do update set ts=excluded.ts', [token, userId, ts]); }
async function deleteSession(token) { await q('delete from sessions where token=$1', [token]); }
async function deleteSessionsForUser(userId) { await q('delete from sessions where user_id=$1', [userId]); }
async function pruneSessions(cutoffTs) { await q('delete from sessions where ts < $1', [cutoffTs]); }

/* ---- analytics + export (leveraging the normalized tables) ---- */
const NUM = c => `(case when ${c} ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$' then ${c}::float else 0 end)`;
async function analytics() {
  const defects = {}; (await q(`select defect, sum(${NUM('"weight_kg"')}) kg from stage2_rows where coalesce(defect,'')<>'' group by defect`)).rows.forEach(r => defects[r.defect] = Number(r.kg));
  const wasteByMachine = {}; (await q(`select j.machine m, sum(${NUM('"waste_kg"')}) kg from stage3_rolls r join jobs j on j.job_no=r.job_no group by j.machine`)).rows.forEach(r => wasteByMachine[r.m] = Number(r.kg));
  const d = (await q(`select coalesce(sum(${NUM('"setup_hours"')}),0) setup, coalesce(sum(${NUM('"dt_material"')}),0) material, coalesce(sum(${NUM('"dt_windup"')}),0) windup, coalesce(sum(${NUM('"dt_damage"')}),0) damage, coalesce(sum(${NUM('"dt_mechanical"')}),0) mechanical, coalesce(sum(${NUM('"dt_electrical"')}),0) electrical, coalesce(sum(${NUM('"dt_others"')}),0) others from stage3`)).rows[0] || {};
  const downtime = { Setup: Number(d.setup||0), Material: Number(d.material||0), Windup: Number(d.windup||0), Damage: Number(d.damage||0), Mechanical: Number(d.mechanical||0), Electrical: Number(d.electrical||0), Others: Number(d.others||0) };
  const total = Number((await q('select count(*)::int c from jobs')).rows[0].c);
  const released = Number((await q(`select count(*)::int c from jobs j
      left join stage1 s1 on s1.job_no=j.job_no left join stage2 s2 on s2.job_no=j.job_no
      left join stage3 s3 on s3.job_no=j.job_no left join stage4 s4 on s4.job_no=j.job_no
    where j.status_override='Released' or (j.status_override is null and coalesce(s1.done,false) and coalesce(s2.done,false) and coalesce(s3.done,false) and coalesce(s4.done,false))`)).rows[0].c);
  const rejectedJobs = Number((await q(`select count(*)::int c from stage4 where coalesce(status_final,'')<>'' and status_final<>'Released'`)).rows[0].c);
  return { defects, wasteByMachine, downtime, kpis: { total, released, rejectedJobs, firstPassYield: total ? Math.round((released/total)*100) : 0 } };
}
async function defectExportRows() {
  const r = await q(`select j.job_no, j.machine, r.roll, r.defect, r.total_meters, r.waste_in, r.waste_out, r.weight_kg
    from stage2_rows r join jobs j on j.job_no=r.job_no
    where coalesce(r.defect,'')<>'' or coalesce(r.weight_kg,'')<>'' or coalesce(r.total_meters,'')<>''
    order by j.seq desc, r.position`);
  return r.rows.map(x => ({ jobNo: x.job_no, machine: x.machine, roll: x.roll, defect: x.defect, totalMeters: x.total_meters, wasteIn: x.waste_in, wasteOut: x.waste_out, weightKg: x.weight_kg }));
}

async function close() { if (pool) await pool.end(); }

module.exports = {
  init, close,
  getJob, listJobs, createJob, saveStage, setStatusOverride,
  findUser, loginPickerUsers, adminListUsers, adminGetUser, createUser, updateUser, deleteUser, countActiveAdmins,
  getMasterdata, updateMasterdata,
  addAudit, getAudit,
  loadSessions, saveSession, deleteSession, deleteSessionsForUser, pruneSessions,
  analytics, defectExportRows
};
