/* Last Date: logic shared by the page and the service worker. */
(function (g) {
  'use strict';

  /* ---------- storage: one small IndexedDB store, readable from page and service worker ---------- */
  const DB = 'lastdate', ST = 'kv';
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const get = async k => {
    const db = await open();
    return new Promise((res, rej) => {
      const q = db.transaction(ST).objectStore(ST).get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  };
  const set = async (k, v) => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(ST, 'readwrite');
      tx.objectStore(ST).put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  };
  // read-modify-write inside one transaction, so the page and the service worker never clobber each other
  const update = async (k, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(ST, 'readwrite');
      const s = tx.objectStore(ST);
      const q = s.get(k);
      q.onsuccess = () => { s.put(fn(q.result), k); };
      tx.oncomplete = () => res();
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  };
  const clear = async () => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(ST, 'readwrite');
      tx.objectStore(ST).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  };

  /* ---------- share-link codec: job -> compressed, URL-safe text ---------- */
  const b64 = bytes => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64 = str => {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const s = atob(str), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  const pipe = async (bytes, stream) => {
    const w = stream.writable.getWriter();
    w.write(bytes).catch(() => {});
    w.close().catch(() => {});
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  };
  async function encode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream !== 'undefined') {
      try { return 'z' + b64(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (e) { /* fall through */ }
    }
    return 'r' + b64(raw);
  }
  async function decode(str) {
    const bytes = unb64(str.slice(1));
    const raw = str[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    return JSON.parse(new TextDecoder().decode(raw));
  }
  const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  /* ---------- dates (all local time) ---------- */
  const pad = n => String(n).padStart(2, '0');
  const at = (d, t) => {
    const [y, m, dd] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
    return new Date(y, m - 1, dd, h, mi);
  };
  const shiftDay = (d, n) => {
    const [y, m, dd] = d.split('-').map(Number), x = new Date(y, m - 1, dd + n);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  const todayStr = () => {
    const x = new Date();
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  const deadlineAt = j => at(j.d, j.t || '23:59');
  const daysLeft = (j, now) => {
    const [y, m, d] = j.d.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  };
  const fmtTime = t => at('2000-01-01', t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dateLabel = j => at(j.d, '00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  /* ---------- reminders ---------- */
  // Day-before and last-date reminders go out at the time the admin chose for this job.
  function times(j) {
    const dl = deadlineAt(j);
    let d0 = at(j.d, j.rt || '09:00');
    if (d0 >= dl) d0 = new Date(dl.getTime() - 30 * 60000); // never after the deadline itself
    const d1 = at(shiftDay(j.d, -1), j.rt || '09:00');
    return { d1, d0, dl };
  }

  function message(j, kind, now) {
    now = now || new Date();
    const n = daysLeft(j, now), c = j.company, r = j.role;
    const close = `${dateLabel(j)}, ${fmtTime(j.t || '23:59')}`;
    if (kind === 'posted') return { title: `New job: ${c}`, body: `${r}. Last date ${close}.` };
    if (kind === 'upd') return { title: `Updated: ${c}`, body: `${r}. Last date ${close}.` };
    if (n <= 0) return { title: `Last day: ${c}`, body: `${r}. Closes today at ${fmtTime(j.t || '23:59')}.` };
    if (n === 1) return { title: `Closes tomorrow: ${c}`, body: `${r}. Apply before ${fmtTime(j.t || '23:59')} tomorrow.` };
    return { title: `Closing soon: ${c}`, body: `${r}. ${n} days left.` };
  }

  // Which reminders are due right now, and which should be skipped silently
  // (already covered by a later one, or their moment passed before the job arrived on this device).
  function evaluate(jobs, fired, now) {
    const fire = [], skip = [];
    for (const j of jobs) {
      if (j.applied || now > deadlineAt(j)) continue;
      const t = times(j), recv = j.receivedAt || 0;
      const k0 = j.id + '|d0', k1 = j.id + '|d1';
      const due0 = now >= t.d0 && !fired[k0];
      const due1 = now >= t.d1 && !fired[k1];
      if (due0) {
        if (t.d0 >= recv) fire.push({ job: j, kind: 'd0' }); else skip.push(k0);
        if (due1) skip.push(k1);
      } else if (due1) {
        if (t.d1 >= recv) fire.push({ job: j, kind: 'd1' }); else skip.push(k1);
      }
    }
    return { fire, skip };
  }

  async function runDue(show) {
    const st = await get('state');
    if (!st || !st.jobs || !st.jobs.length) return [];
    const now = new Date();
    const fired = (await get('fired')) || {};
    const { fire, skip } = evaluate(st.jobs, fired, now);
    if (!fire.length && !skip.length) return [];
    const out = [];
    await update('fired', cur => {
      cur = cur || {};
      for (const k of skip) if (!cur[k]) cur[k] = { t: +now, skip: 1 };
      for (const f of fire) {
        const key = f.job.id + '|' + f.kind;
        if (cur[key]) continue; // the other side (page or worker) got there first
        const m = message(f.job, f.kind, now);
        cur[key] = { t: +now, title: m.title, body: m.body, read: 0 };
        out.push({ key, jobId: f.job.id, title: m.title, body: m.body });
      }
      return cur;
    });
    for (const m of out) { try { await show(m); } catch (e) { /* ignore */ } }
    return out;
  }

  const setFired = (key, val) => update('fired', cur => { cur = cur || {}; cur[key] = val; return cur; });
  const clearFired = (id, kinds) => update('fired', cur => {
    cur = cur || {};
    for (const k of Object.keys(cur)) {
      const [jid, kind] = k.split('|');
      if (jid === id && (!kinds || kinds.includes(kind))) delete cur[k];
    }
    return cur;
  });


  /* ---------- admin signing (ECDSA P-256): friends only accept jobs signed by the admin's key ---------- */
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };
  const FIELDS = ['i', 'v', 'c', 'r', 'd', 't', 'rt', 'l', 'e', 'p', 'o', 'n', 'a', 'at'];
  // the exact bytes that get signed: a fixed-order list of the job fields
  const canon = p => new TextEncoder().encode(JSON.stringify(FIELDS.map(k => p[k] == null ? '' : p[k])));
  async function newAdminKey() {
    const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    return { d: jwk.d, x: jwk.x, y: jwk.y };
  }
  async function sign(key, payload) {
    const pk = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: key.d, x: key.x, y: key.y }, ALG, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign(SIG, pk, canon(payload)));
    return Object.assign({}, payload, { k: key.x + key.y, s: b64(sig) });
  }
  async function verify(p) {
    try {
      if (!p || typeof p.k !== 'string' || p.k.length !== 86 || typeof p.s !== 'string') return false;
      const pk = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: p.k.slice(0, 43), y: p.k.slice(43) }, ALG, false, ['verify']);
      return await crypto.subtle.verify(SIG, pk, unb64(p.s), canon(p));
    } catch (e) { return false; }
  }
  const backupOf = k => 'LDK1.' + b64(new TextEncoder().encode(JSON.stringify({ d: k.d, x: k.x, y: k.y })));
  function readBackup(s) {
    try {
      s = String(s || '').trim();
      if (!s.startsWith('LDK1.')) return null;
      const k = JSON.parse(new TextDecoder().decode(unb64(s.slice(5))));
      return (k.d && k.x && k.y && k.x.length === 43 && k.y.length === 43) ? { d: k.d, x: k.x, y: k.y } : null;
    } catch (e) { return null; }
  }

  g.LD = { get, set, update, clear, encode, decode, newId, pad, at, shiftDay, todayStr, deadlineAt, daysLeft, fmtTime, dateLabel, times, message, evaluate, runDue, setFired, clearFired, newAdminKey, sign, verify, backupOf, readBackup };
})(typeof self !== 'undefined' ? self : window);