'use strict';
/* Golden Manufacturers - Starkist Label QA System (on-prem server, zero external deps) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const PUB = path.join(ROOT, 'public');
fs.mkdirSync(UP_DIR, { recursive: true });

const BC = require('./integrations/businessCentral');
const NOTIFY = require('./integrations/notify');
const AVT = require('./integrations/avtImport');

/* ---------- tiny persistence layer (swap for SQLite/Postgres later) ---------- */
let DB = null;
function loadDB() {
  if (fs.existsSync(DB_FILE)) { DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  else { DB = seedDB(); saveDB(); }
}
let saveTimer = null;
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2)); }
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
function mkUser(id, name, role, pin) { const salt = crypto.randomBytes(6).toString('hex'); return { id, name, role, salt, pinHash: hashPin(pin, salt) }; }

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
    jobs: seedJobs(),
    audit: [{ ts: new Date().toISOString(), user: 'system', action: 'seed', jobNo: '', detail: 'Database initialised' }]
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

/* ---------- helpers ---------- */
const SESS = {}; // token -> {userId, ts}
function newToken() { return crypto.randomBytes(16).toString('hex'); }
function userByToken(req) { const t = (req.headers['authorization']||'').replace(/^Bearer /,'') || req.headers['x-token']; const s = t && SESS[t]; return s ? DB.users.find(u=>u.id===s.userId) : null; }
function audit(user, action, jobNo, detail) { DB.audit.push({ ts:new Date().toISOString(), user:user?user.id:'anon', action, jobNo:jobNo||'', detail:detail||'' }); if (DB.audit.length>5000) DB.audit = DB.audit.slice(-5000); }
function completedStages(j){ return [1,2,3,4].filter(n=>j['stage'+n]&&j['stage'+n]._done).length; }
function jobStatus(j){ if(j.statusOverride) return j.statusOverride; const c=completedStages(j); return c===0?'New':(c<4?'In Progress':'Released'); }

function send(res, code, obj, headers) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': typeof obj==='string'?'text/plain':'application/json', 'Cache-Control':'no-store' }, headers||{}));
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
function readBody(req) { return new Promise((resolve)=>{ let d=''; req.on('data',c=>{ d+=c; if(d.length>25*1024*1024) req.destroy(); }); req.on('end',()=>{ try{ resolve(d?JSON.parse(d):{}); }catch(e){ resolve({}); } }); }); }

/* ---------- API ---------- */
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1);
  const method = req.method;

  if (seg[0]==='health') return send(res,200,{ ok:true, org:CFG.orgName, time:new Date().toISOString() });

  if (seg[0]==='login' && method==='POST') {
    const b = await readBody(req);
    if (b.mode==='sso') { const u = verifySso(b.email); if(!u) return send(res,401,{error:'SSO not recognised'}); const t=newToken(); SESS[t]={userId:u.id,ts:Date.now()}; audit(u,'login-sso'); return send(res,200,{ token:t, user:pubUser(u) }); }
    const u = DB.users.find(x=>x.id===b.userId);
    if (!u || u.pinHash !== hashPin(String(b.pin||''), u.salt)) return send(res,401,{error:'Invalid user or PIN'});
    const t=newToken(); SESS[t]={userId:u.id,ts:Date.now()}; audit(u,'login'); return send(res,200,{ token:t, user:pubUser(u) });
  }
  if (seg[0]==='users' && method==='GET') return send(res,200, DB.users.map(pubUser)); // for login picker

  const user = userByToken(req);
  if (!user) return send(res,401,{error:'Not authenticated'});

  if (seg[0]==='me') return send(res,200,{ user:pubUser(user) });

  if (seg[0]==='jobs' && method==='GET' && !seg[1]) {
    return send(res,200, DB.jobs.map(j=>({ jobNo:j.jobNo, product:j.product, customer:j.customer, machine:j.machine, created:j.created, status:jobStatus(j), completed:completedStages(j) })));
  }
  if (seg[0]==='jobs' && method==='GET' && seg[1]) {
    const j = DB.jobs.find(x=>x.jobNo.toLowerCase()===decodeURIComponent(seg[1]).toLowerCase());
    return j ? send(res,200,j) : send(res,404,{error:'Job not found'});
  }
  if (seg[0]==='jobs' && method==='POST') {
    const b = await readBody(req);
    if(!b.jobNo||!b.machine) return send(res,400,{error:'jobNo and machine required'});
    if(DB.jobs.find(x=>x.jobNo.toLowerCase()===b.jobNo.toLowerCase())) return send(res,409,{error:'Job already exists'});
    const job={ jobNo:b.jobNo, machine:b.machine, customer:b.customer||'StarKist', product:b.product||'', description:b.description||'', created:new Date().toISOString().slice(0,10), stage1:{_done:false},stage2:{_done:false},stage3:{_done:false},stage4:{_done:false} };
    DB.jobs.unshift(job); audit(user,'create-job',job.jobNo); saveDB(); return send(res,200,job);
  }
  if (seg[0]==='jobs' && seg[2]==='stage' && method==='PUT') {
    const j = DB.jobs.find(x=>x.jobNo.toLowerCase()===decodeURIComponent(seg[1]).toLowerCase());
    if(!j) return send(res,404,{error:'Job not found'});
    const n = seg[3]; const b = await readBody(req);
    j['stage'+n] = b.data || {};
    if(n==='4' && b.data && b.data._done && b.data.statusFinal){ j.statusOverride = b.data.statusFinal==='Released'?'Released':'Hold'; if(j.statusOverride!=='Released'){ NOTIFY.alert(CFG,'Job '+j.jobNo+' set to '+j.statusOverride,'Stage 4 decision: '+b.data.statusFinal+' (qty '+(b.data.rejectedQty||'?')+')'); } }
    audit(user,'save-stage'+n,j.jobNo, b.data&&b.data._done?'completed':'draft'); saveDB(); return send(res,200,j);
  }
  if (seg[0]==='jobs' && seg[2]==='hold' && method==='POST') {
    const j = DB.jobs.find(x=>x.jobNo.toLowerCase()===decodeURIComponent(seg[1]).toLowerCase());
    if(!j) return send(res,404,{error:'Job not found'}); const b=await readBody(req);
    j.statusOverride='Hold'; audit(user,'hold',j.jobNo,b.reason||''); NOTIFY.alert(CFG,'Job '+j.jobNo+' placed on HOLD', (b.reason||'')+' by '+user.name); saveDB(); return send(res,200,j);
  }

  if (seg[0]==='upload' && method==='POST') { // {dataUrl, name}
    const b = await readBody(req); const m=/^data:(image\/\w+);base64,(.+)$/.exec(b.dataUrl||'');
    if(!m) return send(res,400,{error:'Invalid image data'});
    const ext = m[1]==='image/png'?'.png':'.jpg'; const fn = Date.now()+'-'+crypto.randomBytes(4).toString('hex')+ext;
    fs.writeFileSync(path.join(UP_DIR,fn), Buffer.from(m[2],'base64')); audit(user,'upload-photo','',fn);
    return send(res,200,{ url:'/uploads/'+fn });
  }

  if (seg[0]==='masterdata' && method==='GET') return send(res,200, DB.masterdata);
  if (seg[0]==='masterdata' && method==='PUT') { const b=await readBody(req); DB.masterdata=Object.assign(DB.masterdata,b); audit(user,'update-masterdata'); saveDB(); return send(res,200,DB.masterdata); }

  if (seg[0]==='audit' && method==='GET') return send(res,200, DB.audit.slice(-300).reverse());

  if (seg[0]==='bc' && seg[1]==='job' && method==='GET') { const r = await BC.lookupJob(CFG, decodeURIComponent(seg[2]||'')); return send(res, r.error?502:200, r); }

  if (seg[0]==='avt-import' && method==='POST') { const b=await readBody(req); const r=AVT.parse(b.csv||''); return send(res,200,r); }

  if (seg[0]==='analytics' && method==='GET') return send(res,200, analytics());

  return send(res,404,{error:'Unknown API route'});
}
function pubUser(u){ return { id:u.id, name:u.name, role:u.role }; }
function verifySso(email){ if(!email) return null; const dom='@'+CFG.sso.allowedDomain; if(!String(email).toLowerCase().endsWith(dom)) return null; const id=String(email).split('@')[0].toLowerCase(); return DB.users.find(u=>u.id===id) || { id, name:email.split('@')[0], role:'Quality Manager' }; }

function analytics(){
  const defects={}, wasteByMachine={}, downtime={Setup:0,Material:0,Windup:0,Damage:0,Mechanical:0,Electrical:0,Others:0};
  let released=0, total=DB.jobs.length, rejectedJobs=0;
  DB.jobs.forEach(j=>{
    if(jobStatus(j)==='Released') released++;
    const s2=j.stage2||{}; (s2.rows||[]).forEach(r=>{ if(r.defect){ defects[r.defect]=(defects[r.defect]||0)+(parseFloat(r.weightKg)||0.0); } });
    const s3=j.stage3||{}; const w=(s3.rolls||[]).reduce((a,r)=>a+(parseFloat(r.wasteKg)||0),0); wasteByMachine[j.machine]=(wasteByMachine[j.machine]||0)+w;
    if(s3){ downtime.Setup+=parseFloat(s3.setupHours)||0; downtime.Material+=parseFloat(s3.dtMaterial)||0; downtime.Windup+=parseFloat(s3.dtWindup)||0; downtime.Damage+=parseFloat(s3.dtDamage)||0; downtime.Mechanical+=parseFloat(s3.dtMechanical)||0; downtime.Electrical+=parseFloat(s3.dtElectrical)||0; downtime.Others+=parseFloat(s3.dtOthers)||0; }
    const s4=j.stage4||{}; if(s4.statusFinal && s4.statusFinal!=='Released') rejectedJobs++;
  });
  const fpy = total? Math.round((released/total)*100):0;
  return { defects, wasteByMachine, downtime, kpis:{ total, released, rejectedJobs, firstPassYield:fpy } };
}

/* ---------- HTTP server ---------- */
loadDB();
const server = http.createServer((req,res)=>{
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req,res,url).catch(e=>{ console.error(e); send(res,500,{error:String(e)}); });
  if (url.pathname.startsWith('/uploads/')) return serveStatic(res, path.join(UP_DIR, path.basename(url.pathname)));
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(PUB, p));
  if (!filePath.startsWith(PUB)) return send(res,403,'Forbidden');
  fs.existsSync(filePath) ? serveStatic(res, filePath) : serveStatic(res, path.join(PUB,'index.html'));
});
const PORT = process.env.PORT || CFG.port;
server.listen(PORT, CFG.host, ()=> console.log('Golden QA server on http://'+CFG.host+':'+PORT+'  ('+CFG.orgName+')'));
module.exports = { server };
