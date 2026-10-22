'use strict';
/* Zero-dependency e-mail sender for hold/reject alerts, manager digest and password-reset links.
   Two transports, Node built-ins only:
     - Resend HTTP API (resendApiKey set): preferred on serverless (Vercel), where one HTTPS call is
       quicker and more reliable than holding an SMTP session open.
     - SMTP (net, tls): implicit TLS (465) and STARTTLS (587), optional AUTH LOGIN — the on-prem relay.
   Plain or multipart/alternative bodies. Never throws. */
const net = require('net'); const tls = require('tls');

function b64(s){ return Buffer.from(String(s),'utf8').toString('base64'); }

function isEnabled(e){ return !!(e && e.enabled && (e.resendApiKey || e.smtpHost)); }

/* Resend: POST /emails. `from` must be on a domain verified in the Resend account. The API key is
   only ever sent in the Authorization header and never logged; errors carry Resend's message only. */
function sendResend(e, from, recips, msg){
  const ctl = new AbortController(); const timer = setTimeout(()=>ctl.abort(), 15000); // same budget as SMTP
  const body = { from, to:recips, subject:String(msg.subject||'').replace(/[\r\n]+/g,' '), text:msg.text||'' };
  if(msg.html) body.html = msg.html;
  return fetch(e.resendApiUrl || 'https://api.resend.com/emails', { method:'POST', signal:ctl.signal,
      headers:{ 'Authorization':'Bearer '+e.resendApiKey, 'Content-Type':'application/json' }, body:JSON.stringify(body) })
    .then(async r=>{ if(r.ok) return { ok:true }; const j=await r.json().catch(()=>({})); return { ok:false, error:'Resend '+r.status+': '+(j.message||j.name||r.statusText||'error') }; })
    .catch(err=>({ ok:false, error:'Resend: '+(err && err.name==='AbortError' ? 'timeout' : String(err && err.message || err)) }))
    .finally(()=>clearTimeout(timer));
}

function send(CFG, msg){
  const e = (CFG && CFG.notify && CFG.notify.email) || {};
  if(!isEnabled(e)) return Promise.resolve({ ok:false, error:'email disabled' });
  const recips = [].concat(msg.to || e.to || []).map(s=>String(s).trim()).filter(Boolean);
  if(!recips.length) return Promise.resolve({ ok:false, error:'no recipients' });
  if(e.resendApiKey){
    // No localhost fallback here: Resend rejects any sender that isn't on a verified domain.
    if(!e.from) return Promise.resolve({ ok:false, error:'EMAIL_FROM is not set (needed for Resend)' });
    return sendResend(e, e.from, recips, msg);
  }
  return sendSmtp(e, recips, msg);
}

function sendSmtp(e, recips, msg){
  return new Promise((resolve)=>{
    const from = e.from || 'qa@localhost';
    // EMAIL_FROM may carry a display name ("Golden QA <qa@gml.com.fj>"): the From: header keeps it,
    // but the SMTP envelope (MAIL FROM) must be the bare address or relays answer 501.
    const m = /<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(from); const envFrom = m ? m[1] : from;
    const secure = !!e.secure;
    const port = e.smtpPort || (secure ? 465 : 587);
    const rejectUnauthorized = e.rejectUnauthorized !== false;

    let sock=null, done=false, buf='', waiter=null, timer=null;
    function finish(res){ if(done) return; done=true; if(timer) clearTimeout(timer); try{ sock && sock.destroy(); }catch(_){} resolve(res); }
    function fail(err){ finish({ ok:false, error:String(err&&err.message||err) }); }
    function rearm(){ if(timer) clearTimeout(timer); timer=setTimeout(()=>fail('SMTP timeout'), 15000); }

    // Read a complete SMTP reply: scan buffered lines for a final "NNN " line.
    function expect(){ return new Promise((res,rej)=>{ waiter={res,rej}; pump(); }); }
    function pump(){
      if(!waiter) return;
      const lines = buf.split(/\r?\n/);
      for(let i=0;i<lines.length-1;i++){
        const ln=lines[i];
        if(/^\d{3} /.test(ln)){
          buf = lines.slice(i+1).join('\n');
          const code = parseInt(ln.slice(0,3),10);
          const w=waiter; waiter=null;
          return (code>=200 && code<400) ? w.res({code,line:ln}) : w.rej(new Error('SMTP '+ln));
        }
      }
    }
    function onData(d){ buf += (typeof d==='string'? d : d.toString('utf8')); rearm(); pump(); }
    function line(s){ rearm(); sock.write(s+'\r\n'); }

    // Attach our data/error/close handlers to the active socket.
    function bind(s){ sock=s; sock.setEncoding('utf8'); sock.removeAllListeners('data'); sock.on('data', onData); sock.on('error', fail); sock.on('close', ()=>{ if(!done) fail(new Error('connection closed')); }); }
    async function transact(){
      try{
        line('EHLO golden-qa'); await expect();
        if(e.user && e.pass){
          line('AUTH LOGIN'); await expect();   // 334 Username
          line(b64(e.user)); await expect();     // 334 Password
          line(b64(e.pass)); await expect();     // 235 authenticated
        }
        line('MAIL FROM:<'+envFrom+'>'); await expect();
        for(const r of recips){ line('RCPT TO:<'+r+'>'); await expect(); }
        line('DATA'); await expect();            // 354 start mail input
        sock.write(buildMessage(from, recips, msg));
        line('.'); await expect();               // 250 queued
        line('QUIT');                            // fire-and-forget
        finish({ ok:true });
      }catch(err){ fail(err); }
    }

    rearm();
    if(secure){
      const s=tls.connect({ host:e.smtpHost, port, servername:e.smtpHost, rejectUnauthorized }, ()=>{});
      s.on('error', fail);
      s.once('secureConnect', async ()=>{ bind(s); try{ await expect(); transact(); }catch(err){ fail(err); } });
    } else {
      const plain=net.connect({ host:e.smtpHost, port }, ()=>{});
      bind(plain);
      (async ()=>{
        try{
          await expect();                        // 220 greeting
          line('EHLO golden-qa'); await expect();
          line('STARTTLS'); await expect();      // 220 ready to start TLS
          plain.removeAllListeners(); buf=''; waiter=null;
          const up=tls.connect({ socket:plain, servername:e.smtpHost, rejectUnauthorized }, ()=>{});
          up.on('error', fail);
          up.once('secureConnect', ()=>{ bind(up); transact(); });
        }catch(err){ fail(err); }
      })();
    }
  });
}

function dotStuff(s){ return String(s||'').replace(/\r?\n/g,'\r\n').replace(/^\./gm,'..'); }

function buildMessage(from, recips, msg){
  const subject=(msg.subject||'').replace(/[\r\n]+/g,' ');
  const head=['From: '+from, 'To: '+recips.join(', '), 'Subject: '+subject, 'Date: '+new Date().toUTCString(), 'MIME-Version: 1.0'];
  let body;
  if(msg.html){
    const bnd='gqa_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    head.push('Content-Type: multipart/alternative; boundary="'+bnd+'"');
    body = '--'+bnd+'\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n'+dotStuff(msg.text||'')+
      '\r\n--'+bnd+'\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n'+dotStuff(msg.html)+
      '\r\n--'+bnd+'--';
  } else {
    head.push('Content-Type: text/plain; charset=UTF-8');
    body = dotStuff(msg.text||'');
  }
  return head.join('\r\n')+'\r\n\r\n'+body+'\r\n';
}

module.exports = { send, isEnabled };
