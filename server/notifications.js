import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { request as httpsRequest } from 'node:https';
import { accountIdFromPublicKey } from '../src/lib/addressing/account-id.js';

export const NOTIFICATION_PROTOCOL = 'automesh-notifications-v1';
const HOUR = 3600000, DAY = 24 * HOUR;
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{22,86}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('base64url');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === keys.sort().join();
export function notificationProvider(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' || u.search || u.hash ||
      !['/api/notifications', '/api/notifications/'].includes(u.pathname) ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(u.hostname) ||
      /\.(?:localhost|local|internal|test|invalid|example)$/.test(u.hostname)) return null;
    return `${u.origin}/api/notifications`;
  } catch { return null; }
}
// This is an outbound allowlist, not an arbitrary user-supplied HTTP relay.
// Brave and Vivaldi use the Chromium/Google push infrastructure too.
export function validPushSubscription(value) {
  if (!exact(value, ['endpoint', 'keys']) || !exact(value.keys, ['p256dh', 'auth'])) return false;
  try {
    const u = new URL(value.endpoint);
    if (value.endpoint.length > 2048 || u.protocol !== 'https:' || u.username || u.password || u.port || u.hash ||
      !(u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
        u.hostname === 'web.push.apple.com' || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname))) return false;
    const pub = Buffer.from(value.keys.p256dh, 'base64url'), auth = Buffer.from(value.keys.auth, 'base64url');
    return /^[A-Za-z0-9_-]+$/.test(value.keys.p256dh) && /^[A-Za-z0-9_-]+$/.test(value.keys.auth) && pub.length === 65 && pub[0] === 4 && auth.length === 16;
  } catch { return false; }
}
export function notificationProof(provider, action, input) {
  return new TextEncoder().encode(JSON.stringify([NOTIFICATION_PROTOCOL, provider, action, input.account, input.device, input.at, input.nonce, input.body]));
}
// Bound the whole HTTPS operation, including DNS/TLS and response handling.
// The library supplies the standard encryption/VAPID, not an unbounded socket.
export const notificationRequestDetails=(subscription,payload,options)=>webpush.generateRequestDetails(subscription,payload,options);
export function sendWebPush(subscription,payload,options) {
  const details=notificationRequestDetails(subscription,payload,options);
  return new Promise((resolve,reject)=>{
    const req=httpsRequest(details.endpoint,{method:details.method,headers:details.headers,signal:AbortSignal.timeout(10000)},res=>{
      res.resume();res.on('error',reject);res.on('end',()=>res.statusCode>=200&&res.statusCode<300?resolve({statusCode:res.statusCode}):reject(Object.assign(Error('push_rejected'),{statusCode:res.statusCode})));
    });
    req.on('error',reject);req.end(details.body);
  });
}

// Lazy and isolated: a missing SQLite runtime, bad notification configuration,
// expired subscription or failed push must never stop chat/signaling startup.
export function createNotifications({ origin, directory, now = Date.now, send = sendWebPush, enabled = true } = {}) {
  const provider = `${origin}/api/notifications`;
  let db, opening, timer, draining = false, stopped = false;
  const budgets = new Map();
  async function open() {
    if (!enabled || stopped) throw Error('notifications_unavailable');
    if (db) return;
    if (opening) return opening;
    opening = (async () => {
      const { DatabaseSync } = await import('node:sqlite');
      const dir = directory ?? join(homedir(), '.automesh-notifications', hash(origin).slice(0, 16));
      if (dir !== ':memory:') mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = dir === ':memory:' ? dir : join(dir, 'notifications.sqlite');
      const candidate = new DatabaseSync(file, { timeout: 100 });
      try {
        candidate.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
          PRAGMA journal_size_limit=1048576; PRAGMA max_page_count=65536;
          CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS devices(account TEXT NOT NULL,device TEXT NOT NULL,subscription TEXT NOT NULL,allowed TEXT NOT NULL,locale TEXT NOT NULL,node INTEGER NOT NULL,active INTEGER NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(account,device));
          CREATE TABLE IF NOT EXISTS replay(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS job_events(id TEXT PRIMARY KEY,event TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS policies(account TEXT NOT NULL,device TEXT NOT NULL,muted TEXT NOT NULL,viewing TEXT NOT NULL,visible_until INTEGER NOT NULL,PRIMARY KEY(account,device));
          CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,account TEXT NOT NULL,device TEXT NOT NULL,peer TEXT NOT NULL,kind TEXT NOT NULL,due INTEGER NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS waiting(account TEXT NOT NULL,device TEXT NOT NULL,peer TEXT NOT NULL,token TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(account,device,peer));
          CREATE TABLE IF NOT EXISTS returns(account TEXT NOT NULL,device TEXT NOT NULL,peer TEXT NOT NULL,route TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(account,device,peer));
          CREATE INDEX IF NOT EXISTS due_jobs ON jobs(due,lease);`);
        candidate.exec('BEGIN IMMEDIATE');
        try {
          if (!candidate.prepare('SELECT value FROM config WHERE key=?').get('vapid')) candidate.prepare('INSERT INTO config VALUES(?,?)').run('vapid', JSON.stringify(webpush.generateVAPIDKeys()));
          candidate.exec('COMMIT');
        } catch (e) { candidate.exec('ROLLBACK'); throw e; }
        if (file !== ':memory:') chmodSync(file, 0o600);
        if (stopped) { candidate.close(); return; }
        db = candidate;
        timer = setInterval(() => { void drain().catch(() => {}); }, 15000); timer.unref?.();
      } catch (e) { candidate.close(); throw e; }
    })().finally(() => { opening = undefined; });
    return opening;
  }
  function clean() {
    const t = now();
    for (const table of ['devices','replay','jobs','waiting','returns','events']) db.prepare(`DELETE FROM ${table} WHERE expires<=?`).run(t);
    db.exec('DELETE FROM policies WHERE NOT EXISTS(SELECT 1 FROM devices WHERE devices.account=policies.account AND devices.device=policies.device)');
    db.exec('DELETE FROM job_events WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.id=job_events.id)');
    for (const [key, b] of budgets) if (b.until <= t) budgets.delete(key);
  }
  function budget(key, limit) {
    let b = budgets.get(key);
    if (!b || b.until <= now()) { if (budgets.size >= 20000) throw Error('notifications_rate'); b = { n: 0, until: now() + 60000 }; budgets.set(key, b); }
    if (++b.n > limit) throw Error('notifications_rate');
  }
  function removeDevice(account, device) {
    for (const table of ['devices','jobs','waiting','returns','policies']) db.prepare(`DELETE FROM ${table} WHERE account=? AND device=?`).run(account, device);
  }
  function cancelWaiting(account, device, peer) {
    db.prepare('DELETE FROM waiting WHERE account=? AND device=? AND peer=?').run(account, device, peer);
    db.prepare("DELETE FROM jobs WHERE account=? AND device=? AND peer=? AND kind='return'").run(account, device, peer);
  }
  async function authenticate(input, action) {
    if (!exact(input, ['account','device','at','nonce','body','publicKey','signature']) || !token(input.device) || !token(input.nonce) ||
      !Number.isSafeInteger(input.at) || Math.abs(input.at - now()) > 120000 || typeof input.account !== 'string' ||
      typeof input.publicKey !== 'string' || input.publicKey.length !== 87 || typeof input.signature !== 'string' || input.signature.length !== 86) throw Error('notifications_auth');
    budget(`auth:${hash(input.publicKey)}`, 120);
    const pub = Buffer.from(input.publicKey, 'base64url');
    if (await accountIdFromPublicKey(pub, webcrypto.subtle) !== input.account) throw Error('notifications_auth');
    const key = await webcrypto.subtle.importKey('raw', pub, { name:'ECDSA',namedCurve:'P-256' }, false, ['verify']);
    if (!await webcrypto.subtle.verify({ name:'ECDSA',hash:'SHA-256' },key,Buffer.from(input.signature,'base64url'),notificationProof(provider, action, input))) throw Error('notifications_auth');
    if (db.prepare('SELECT count(*) n FROM replay').get().n >= 50000) throw Error('notifications_capacity');
    try { db.prepare('INSERT INTO replay VALUES(?,?)').run(hash(`${input.account}:${input.nonce}`), now() + 240000); }
    catch { throw Error('notifications_replay'); }
  }
  const deviceFor = input => db.prepare('SELECT * FROM devices WHERE account=? AND device=? AND expires>?').get(input.account,input.device,now());
  function requireDevice(input) { const d=deviceFor(input); if (!d) throw Error('notifications_device'); return d; }
  function allowed(d, peer) { return JSON.parse(d.allowed).includes(peer); }
  function suppressed(account,device,peer){
    const p=db.prepare('SELECT * FROM policies WHERE account=? AND device=?').get(account,device);if(!p)return false;
    const until=JSON.parse(p.muted)[peer];return until===-1||until>now()||p.viewing===peer&&p.visible_until>now();
  }
  async function execute(action, input) {
    const b = input.body;
    if(action==='cancel'){
      if(!exact(b,['to','event'])||typeof b.to!=='string'||!token(b.event))throw Error('notifications_input');
      budget(`send:${input.account}`,60);
      for(const d of db.prepare('SELECT * FROM devices WHERE account=? AND expires>? LIMIT 16').all(b.to,now())){
        if(!allowed(d,input.account))continue;
        for(const kind of ['message','attempt']){
          const id=hash(`${b.to}:${d.device}:${input.account}:${kind}`),eventId=hash(`${id}:${b.event}`);
          if(db.prepare('SELECT count(*) n FROM events').get().n<50000)db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)').run(eventId,now()+DAY);
          const queued=db.prepare('SELECT event FROM job_events WHERE id=?').get(id);
          if(queued?.event===b.event){db.prepare('DELETE FROM jobs WHERE id=?').run(id);db.prepare('DELETE FROM job_events WHERE id=?').run(id);}
        }
      }
      return {accepted:true};
    }
    if(action==='view-close'){
      requireDevice(input);if(!exact(b,[]))throw Error('notifications_input');
      db.prepare("UPDATE policies SET viewing='',visible_until=0 WHERE account=? AND device=?").run(input.account,input.device);
      db.prepare('UPDATE devices SET active=0 WHERE account=? AND device=?').run(input.account,input.device);
      return {updated:true};
    }
    if(action==='policy'){
      const d=requireDevice(input);
      if(!exact(b,['muted','viewing'])||!b.muted||typeof b.muted!=='object'||Array.isArray(b.muted)||Object.keys(b.muted).length>500||typeof b.viewing!=='string'||b.viewing!==''&&!allowed(d,b.viewing))throw Error('notifications_input');
      const muted={};for(const [peer,until]of Object.entries(b.muted)){
        if(!/^mesh1[a-z0-9]{30,64}$/.test(peer)||!Number.isSafeInteger(until)||until!==-1&&(until<0||until>now()+31*DAY))throw Error('notifications_input');
        if(allowed(d,peer)&&(until===-1||until>now()))muted[peer]=until;
      }
      db.prepare('INSERT INTO policies VALUES(?,?,?,?,?) ON CONFLICT(account,device) DO UPDATE SET muted=excluded.muted,viewing=excluded.viewing,visible_until=excluded.visible_until').run(input.account,input.device,JSON.stringify(muted),b.viewing,b.viewing?now()+25000:0);
      for(const r of db.prepare('SELECT id,peer FROM jobs WHERE account=? AND device=?').all(input.account,input.device))if(suppressed(input.account,input.device,r.peer))db.prepare('DELETE FROM jobs WHERE id=?').run(r.id);
      for(const r of db.prepare('SELECT peer,route FROM returns WHERE account=? AND device=?').all(input.account,input.device))if(!JSON.parse(r.route).manual&&suppressed(input.account,input.device,r.peer))db.prepare('DELETE FROM returns WHERE account=? AND device=? AND peer=?').run(input.account,input.device,r.peer);
      return {updated:true};
    }
    if (action === 'register') {
      if (!exact(b,['subscription','allowed','locale','node']) || !validPushSubscription(b.subscription) || !Array.isArray(b.allowed) || b.allowed.length > 500 ||
        b.allowed.some(p => typeof p !== 'string' || !/^mesh1[a-z0-9]{30,64}$/.test(p)) || !['ru','en'].includes(b.locale) || typeof b.node !== 'boolean') throw Error('notifications_input');
      const prior=deviceFor(input);
      if (!prior && (db.prepare('SELECT count(*) n FROM devices').get().n >= 10000 || db.prepare('SELECT count(*) n FROM devices WHERE account=?').get(input.account).n >= 16)) throw Error('notifications_capacity');
      db.prepare(`INSERT INTO devices VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account,device) DO UPDATE SET subscription=excluded.subscription,allowed=excluded.allowed,locale=excluded.locale,node=excluded.node,active=excluded.active,expires=excluded.expires`).run(input.account,input.device,JSON.stringify(b.subscription),JSON.stringify([...new Set(b.allowed)]),b.locale,Number(b.node),now()+90000,now()+90*DAY);
      if (b.node) { db.prepare('DELETE FROM waiting WHERE account=? AND device=?').run(input.account,input.device); db.prepare("DELETE FROM jobs WHERE account=? AND device=? AND kind='return'").run(input.account,input.device); db.prepare('DELETE FROM returns WHERE account=? AND device=?').run(input.account,input.device); }
      // Revocation removes queued work too, including previously accepted pushes.
      for (const table of ['jobs','returns']) for (const r of db.prepare(`SELECT DISTINCT peer FROM ${table} WHERE account=? AND device=?`).all(input.account,input.device)) if (!b.allowed.includes(r.peer)) db.prepare(`DELETE FROM ${table} WHERE account=? AND device=? AND peer=?`).run(input.account,input.device,r.peer);
      return { registered:true };
    }
    if (action === 'unregister') { if (!exact(b,[])) throw Error('notifications_input'); removeDevice(input.account,input.device); return { removed:true }; }
    if (action === 'waiting') {
      const d=requireDevice(input);
      if (!exact(b,['peer','token','pending']) || typeof b.peer !== 'string' || !token(b.token) || typeof b.pending !== 'boolean') throw Error('notifications_input');
      if (!b.pending || d.node || !allowed(d,b.peer)) { cancelWaiting(input.account,input.device,b.peer); return { waiting:false }; }
      db.prepare(`INSERT INTO waiting VALUES(?,?,?,?,?) ON CONFLICT(account,device,peer) DO UPDATE SET token=excluded.token,expires=excluded.expires`).run(input.account,input.device,b.peer,b.token,now()+DAY);
      return { waiting:true };
    }
    if(action==='return-route'){
      if(!exact(b,['to','route'])||typeof b.to!=='string'||!/^mesh1[a-z0-9]{30,64}$/.test(b.to))throw Error('notifications_input');
      const r=b.route;
      if(!exact(r,['provider','device','token','expires'])||!notificationProvider(r.provider)||!token(r.device)||!token(r.token)||!Number.isSafeInteger(r.expires)||r.expires<=now()||r.expires>now()+DAY)throw Error('notifications_input');
      budget(`send:${input.account}`,60);
      for(const d of db.prepare('SELECT * FROM devices WHERE account=? AND expires>? LIMIT 16').all(b.to,now())){
        if(d.node||!allowed(d,input.account))continue;
        const exists=db.prepare('SELECT peer FROM returns WHERE account=? AND device=? AND peer=?').get(b.to,d.device,input.account);
        if(!exists&&db.prepare('SELECT count(*) n FROM returns').get().n>=50000)throw Error('notifications_capacity');
        db.prepare('INSERT INTO returns VALUES(?,?,?,?,?) ON CONFLICT(account,device,peer) DO UPDATE SET route=excluded.route,expires=excluded.expires')
          .run(b.to,d.device,input.account,JSON.stringify({...r,manual:true}),r.expires);
      }
      return {accepted:true};
    }
    if (action === 'ready') {
      const d=requireDevice(input);
      if ((!exact(b,['node'])&&!exact(b,['node','peer'])) || typeof b.node !== 'boolean' || b.peer!==undefined&&(typeof b.peer!=='string'||!/^mesh1[a-z0-9]{30,64}$/.test(b.peer))) throw Error('notifications_input');
      db.prepare('UPDATE devices SET active=?,node=? WHERE account=? AND device=?').run(now()+90000,Number(b.node === true),input.account,input.device);
      if (b.node || d.node) return { tickets:[] };
      return { tickets: (b.peer?db.prepare('SELECT peer,route FROM returns WHERE account=? AND device=? AND peer=? AND expires>? LIMIT 32').all(input.account,input.device,b.peer,now()):db.prepare('SELECT peer,route FROM returns WHERE account=? AND device=? AND expires>? LIMIT 32').all(input.account,input.device,now())).filter(r=>allowed(d,r.peer)&&(b.peer||!JSON.parse(r.route).manual)).map(r=>({peer:r.peer,...JSON.parse(r.route)})),
        waiting: db.prepare('SELECT peer,token FROM waiting WHERE account=? AND device=? AND expires>? LIMIT 500').all(input.account,input.device,now()) };
    }
    if (action === 'ready-ack') {
      requireDevice(input);
      if (!exact(b,['peer','token']) || typeof b.peer !== 'string' || !token(b.token)) throw Error('notifications_input');
      const r=db.prepare('SELECT route FROM returns WHERE account=? AND device=? AND peer=?').get(input.account,input.device,b.peer);
      if (r && JSON.parse(r.route).token === b.token) db.prepare('DELETE FROM returns WHERE account=? AND device=? AND peer=?').run(input.account,input.device,b.peer);
      return { accepted:true };
    }
    if (action === 'notify') {
      if (!exact(b,['to','kind','event','returnRoute']) || typeof b.to !== 'string' || !['message','attempt','return'].includes(b.kind) || !token(b.event)) throw Error('notifications_input');
      budget(`send:${input.account}`,60);
      // Reply is deliberately identical for unknown, blocked and known accounts.
      const devices=db.prepare('SELECT * FROM devices WHERE account=? AND expires>? LIMIT 16').all(b.to,now());
      for (const d of devices) {
        if (!allowed(d,input.account)) continue;
        const id=hash(`${b.to}:${d.device}:${input.account}:${b.kind}`);
        const eventId=hash(`${id}:${b.event}`);
        if (db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) continue;
        if(suppressed(b.to,d.device,input.account)){
          if(db.prepare('SELECT count(*) n FROM events').get().n<50000)db.prepare('INSERT INTO events VALUES(?,?)').run(eventId,now()+DAY);
          continue;
        }
        const prior=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
        if (b.kind === 'return') {
          const w=db.prepare('SELECT * FROM waiting WHERE account=? AND device=? AND peer=? AND token=? AND expires>?').get(b.to,d.device,input.account,b.event,now());
          if (!w || d.node || deviceFor(input)?.node || b.returnRoute !== null) continue;
        } else if (b.returnRoute !== null) {
          const r=b.returnRoute;
          if (!exact(r,['provider','device','token','expires']) || !notificationProvider(r.provider) || !token(r.device) || !token(r.token) || !Number.isSafeInteger(r.expires) || r.expires <= now() || r.expires > now()+DAY) throw Error('notifications_input');
          if (!d.node) db.prepare(`INSERT INTO returns VALUES(?,?,?,?,?) ON CONFLICT(account,device,peer) DO UPDATE SET route=excluded.route,expires=excluded.expires`).run(b.to,d.device,input.account,JSON.stringify(r),r.expires);
        }
        // One notification per peer/kind/minute, not one per retry/message.
        if (prior && prior.expires > now()) continue;
        if (db.prepare('SELECT count(*) n FROM jobs').get().n >= 10000 || db.prepare('SELECT count(*) n FROM events').get().n >= 50000) throw Error('notifications_capacity');
        db.prepare('INSERT INTO events VALUES(?,?)').run(eventId,now()+DAY);
        db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?,?,?,?,?,?,?,?)').run(id,b.to,d.device,input.account,b.kind,Math.max(now(),b.kind==='return'?d.active:0),now()+HOUR,0,0);
        db.prepare('INSERT OR REPLACE INTO job_events VALUES(?,?)').run(id,b.event);
      }
      void drain().catch(() => {});
      return { accepted:true };
    }
    if (action === 'test') {
      const d=requireDevice(input); if (!exact(b,[])) throw Error('notifications_input');
      budget(`test:${input.account}`,3);
      await send(JSON.parse(d.subscription), JSON.stringify({ protocol:NOTIFICATION_PROTOCOL,kind:'test',locale:d.locale }), pushOptions(d.device,60));
      return { accepted:true };
    }
    throw Error('notifications_input');
  }
  function pushOptions(id, ttl) {
    const keys=JSON.parse(db.prepare("SELECT value FROM config WHERE key='vapid'").get().value);
    return { vapidDetails:{ subject:origin, publicKey:keys.publicKey,privateKey:keys.privateKey }, TTL:ttl, timeout:8000, urgency:'normal',topic:hash(id).slice(0,32) };
  }
  async function drain() {
    if (!db || draining || stopped) return;
    draining=true;
    try {
      clean();
      // Bound both work per turn and in-flight HTTPS requests. A second worker
      // claims the same SQLite job only after its crashed predecessor's lease.
      for (let n=0;n<8 && !stopped;n++) {
        const job=db.prepare('SELECT * FROM jobs WHERE due<=? AND lease<=? AND attempts<4 ORDER BY due LIMIT 1').get(now(),now());
        if (!job) break;
        if (!db.prepare('UPDATE jobs SET lease=? WHERE id=? AND lease<=?').run(now()+30000,job.id,now()).changes) continue;
        const d=db.prepare('SELECT * FROM devices WHERE account=? AND device=? AND expires>?').get(job.account,job.device,now());
        const waiting=job.kind==='return' && db.prepare('SELECT * FROM waiting WHERE account=? AND device=? AND peer=? AND expires>?').get(job.account,job.device,job.peer,now());
        if (!d || !allowed(d,job.peer) || suppressed(job.account,job.device,job.peer) || job.kind==='return' && (!waiting || d.node)) { db.prepare('DELETE FROM jobs WHERE id=?').run(job.id); continue; }
        if (job.kind==='return' && d.active>now()) { db.prepare('UPDATE jobs SET due=?,lease=0 WHERE id=?').run(d.active,job.id); continue; }
        try {
          await send(JSON.parse(d.subscription),JSON.stringify({protocol:NOTIFICATION_PROTOCOL,kind:job.kind,locale:d.locale}),pushOptions(job.id,Math.max(1,Math.floor((job.expires-now())/1000))));
          if (!db || stopped) break;
          // Keep a small tombstone for deduplication, without endpoint/body logs.
          db.prepare('UPDATE jobs SET attempts=4,expires=?,lease=0 WHERE id=?').run(now()+60000,job.id);
          if (job.kind==='return') cancelWaiting(job.account,job.device,job.peer);
        } catch (e) {
          if (!db || stopped) break;
          if ([404,410].includes(e.statusCode)) removeDevice(job.account,job.device);
          else db.prepare('UPDATE jobs SET attempts=attempts+1,due=?,lease=0 WHERE id=?').run(now()+Math.min(300000,15000*2**job.attempts),job.id);
        }
      }
    } finally { draining=false; }
  }
  async function handle(request,response,pathname) {
    const reply=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Referrer-Policy':'no-referrer'});response.end(JSON.stringify(value));};
    if (request.method==='OPTIONS') {reply(204,{});return;}
    try {
      budget(`ip:${request.socket.remoteAddress ?? 'unknown'}`,3000);
      await open(); clean();
      const action=pathname.slice('/api/notifications/'.length);
      if (request.method==='GET' && action==='config') { const keys=JSON.parse(db.prepare("SELECT value FROM config WHERE key='vapid'").get().value); reply(200,{protocol:NOTIFICATION_PROTOCOL,publicKey:keys.publicKey}); void drain().catch(()=>{}); return; }
      if (request.method!=='POST') {reply(405,{error:'notifications_method'});return;}
      if (request.headers['content-type']!=='application/json' || request.headers['content-encoding']) {reply(400,{error:'notifications_input'});return;}
      let size=0,chunks=[];
      for await (const chunk of request) {size+=chunk.length;if(size>64000){reply(413,{error:'notifications_limit'});return;}chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{reply(400,{error:'notifications_input'});return;}
      await authenticate(input,action);
      reply(200,await execute(action,input));
    } catch(e) {
      const code=typeof e.message==='string'&&/^notifications_[a-z]+$/.test(e.message)?e.message:'notifications_unavailable';
      const status=code==='notifications_rate'||code==='notifications_capacity'?429:code==='notifications_auth'||code==='notifications_replay'?403:code==='notifications_input'?400:503;
      if (!response.headersSent) reply(status,{error:code});else if(!response.writableEnded)response.destroy();
    }
  }
  return {handle,drain,async close(){stopped=true;clearInterval(timer);await opening?.catch(()=>{});while(draining)await new Promise(r=>setTimeout(r,10));db?.close();db=undefined;}};
}
