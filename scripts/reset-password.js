#!/usr/bin/env node
'use strict';
/* Break-glass password reset for a LOCAL account, run on the server itself (not over HTTP).
   Use it when nobody who can reach Admin → Users can sign in. Talks to the same store the app
   uses (PostgreSQL via DATABASE_URL, else data/db.json), takes the app's write lock, sets a new
   scrypt hash and appends a tamper-evident audit entry. Safe to run while the app is up: the app
   reloads the document on every request, so the new password works immediately and every
   existing session for that user is signed out.

   Usage (inside the app container, as the app's user so file ownership stays correct):
     docker exec -it -u node <app-container> node scripts/reset-password.js <username>
     docker exec -it -u node <app-container> node scripts/reset-password.js --list
   Non-interactive: pipe the password on stdin, e.g.  printf '%s' "$PW" | ... <username>
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeStorage } = require('../integrations/storage');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.GQA_DATA_DIR ? path.resolve(ROOT, process.env.GQA_DATA_DIR) : path.join(ROOT, 'data');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
// Must match server.js so the audit chain stays verifiable.
const TOKEN_SECRET = process.env.SECRET_KEY || 'dev-insecure-secret-change-me';
const MIN_LEN = 6; // same rule as Admin → Users and My Account

// Mirrors hashPw / auditHash in server.js (kept here so the script doesn't boot the server).
function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
function auditHash(prevHash, e) {
  const tuple = e && e.v >= 2
    ? [e.ts, e.user, e.action, e.jobNo, e.detail, e.recordType||'', e.recordId||'', e.changes||[]]
    : [e.ts, e.user, e.action, e.jobNo, e.detail];
  return crypto.createHmac('sha256', TOKEN_SECRET).update(String(prevHash||'')+'|'+JSON.stringify(tuple)).digest('hex');
}

function die(msg) { console.error('reset-password: ' + msg); process.exit(1); }

/* Read one line from the terminal without echoing it, or the whole of stdin when piped. */
function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let buf = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => { buf += c; });
      process.stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
      process.stdin.on('error', reject);
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin; let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); return resolve(buf); }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); } // Ctrl-C
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node scripts/reset-password.js <username>\n       node scripts/reset-password.js --list');
    process.exit(args.length ? 0 : 1);
  }
  const storage = makeStorage({ databaseUrl: process.env.DATABASE_URL || '', dbFile: path.join(DATA_DIR, 'db.json'),
    driverPref: (CFG.storage && CFG.storage.driver) || 'json' });
  let lock = null;
  try {
    if (args[0] === '--list') {
      const DB = await storage.load();
      if (!DB || !Array.isArray(DB.users)) die('no database found (' + storage.driver + ') — has the app been started yet?');
      console.log('Users (' + storage.driver + '):');
      DB.users.forEach(u => console.log('  ' + u.id.padEnd(20) + ' ' + String(u.role||'').padEnd(16) + ' ' +
        (u.source === 'ad' || !u.passHash ? 'directory sign-in' : 'local') + (u.archived ? ' (archived)' : '')));
      return;
    }

    const uid = String(args[0]).trim().toLowerCase();
    // Validate the target before prompting, so a typo doesn't cost the user a password entry.
    let DB = await storage.load();
    if (!DB || !Array.isArray(DB.users)) die('no database found (' + storage.driver + ') — has the app been started yet?');
    let u = DB.users.find(x => x.id === uid);
    if (!u) die('no user "' + uid + '". Run with --list to see usernames.');
    if (u.source === 'ad' || !u.passHash) die('"' + uid + '" signs in via Active Directory / Microsoft — reset the password there.');
    if (u.archived) die('"' + uid + '" is archived. Restore the account (or reset a different admin) first.');

    const pw = await readSecret('New password for ' + uid + ': ');
    if (pw.length < MIN_LEN) die('password must be at least ' + MIN_LEN + ' characters.');
    if (process.stdin.isTTY) {
      const again = await readSecret('Repeat new password: ');
      if (again !== pw) die('passwords do not match — nothing changed.');
    }

    // Re-load under the app's write lock so we can't clobber a concurrent save.
    if (storage.acquireLock) lock = await storage.acquireLock();
    DB = await storage.load();
    u = DB.users.find(x => x.id === uid);
    if (!u) die('user "' + uid + '" disappeared while waiting for the lock — nothing changed.');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.passHash = hashPw(pw, u.salt);
    if (!Array.isArray(DB.audit)) DB.audit = [];
    const prev = DB.audit.length ? (DB.audit[DB.audit.length-1].hash || '') : (DB.auditAnchor || '');
    const e = { ts: new Date().toISOString(), user: 'system', action: 'reset-password', jobNo: '',
      detail: 'Password reset from server console for ' + uid, v: 2, recordType: 'user', recordId: uid };
    e.hash = auditHash(prev, e);
    DB.audit.push(e);
    await storage.save(DB);
    console.log('Password for "' + uid + '" updated (' + storage.driver + '). Existing sessions for this user are signed out.');
    console.log('If sign-in still says "Too many failed attempts", restart the app container to clear the lockout.');
  } finally {
    if (lock) await storage.releaseLock(lock);
    await storage.close();
  }
}

main().catch(e => die((e && e.message) || String(e)));
