'use strict';
/* Business Central job-master adapter (OData V4, BC14). Runs server-side so the
   on-prem server reaches bc-test.gml.com.fj. Falls back to a mock when disabled. */
const http = require('http'); const https = require('https');
function get(url, headers){ return new Promise((resolve,reject)=>{ const lib=url.startsWith('https')?https:http; const r=lib.get(url,{headers:headers||{}},res=>{ let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ resolve({status:res.statusCode, json:JSON.parse(d)}); }catch(e){ resolve({status:res.statusCode, json:null, raw:d}); } }); }); r.on('error',reject); r.setTimeout(8000,()=>{ r.destroy(new Error('BC timeout')); }); }); }

async function lookupJob(CFG, jobNo){
  const bc = CFG.businessCentral||{};
  if(!jobNo) return { error:'jobNo required' };
  if(!bc.enabled){
    // Mock so the UI/integration works before BC creds are wired in.
    return { source:'mock', jobNo, item:'Demo Item for '+jobNo, customer:'StarKist', description:'(BC disabled - sample data) Confirm jobService in config.json', note:'Set businessCentral.enabled=true to query live BC.' };
  }
  try{
    const base=bc.baseUrl.replace(/\/$/,'');
    const comp=encodeURIComponent("Company('"+bc.company+"')");
    const url=base+'/'+comp+'/'+bc.jobService+"?$filter=No eq '"+encodeURIComponent(jobNo)+"'&$top=1";
    const headers={}; if(bc.authHeader) headers['Authorization']=bc.authHeader;
    const r=await get(url, headers);
    if(r.status>=400||!r.json) return { error:'BC HTTP '+r.status, detail:r.raw||'' };
    const row=(r.json.value&&r.json.value[0])||null;
    if(!row) return { error:'Job '+jobNo+' not found in BC' };
    return { source:'business-central', jobNo:row.No||jobNo, item:row.Item_Description||row.Description||'', customer:row.Customer_Name||row.Sell_to_Customer_Name||'', raw:row };
  }catch(e){ return { error:'BC unreachable: '+e.message, hint:'Run the server on a host that can reach '+ (bc.baseUrl||'BC') }; }
}
module.exports = { lookupJob };
