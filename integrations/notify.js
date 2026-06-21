'use strict';
/* Alert hooks: Microsoft Teams Incoming Webhook and/or SMTP email. No-op until configured. */
const https = require('https'); const http = require('http'); const url = require('url');
function postJson(target, payload){ return new Promise((resolve)=>{ try{ const u=new URL(target); const lib=u.protocol==='https:'?https:http; const data=JSON.stringify(payload); const req=lib.request(u,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{ res.on('data',()=>{}); res.on('end',()=>resolve(true)); }); req.on('error',()=>resolve(false)); req.write(data); req.end(); }catch(e){ resolve(false); } }); }
function alert(CFG, title, text){
  const n=CFG.notify||{}; const line='['+new Date().toISOString()+'] '+title+' - '+text;
  console.log('NOTIFY:', line);
  if(n.teamsWebhookUrl){ postJson(n.teamsWebhookUrl,{ '@type':'MessageCard','@context':'http://schema.org/extensions', summary:title, themeColor:'B8860B', title:title, text:text }); }
  // Email: wire nodemailer or company SMTP relay here when n.email.enabled.
  return true;
}
module.exports = { alert };
