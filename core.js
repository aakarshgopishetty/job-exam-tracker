/* Last Date: date/reminder logic, plus a tiny local KV store for personal (per-device) bits
   like your name, which jobs you marked "applied", and which reminders you've already seen.
   The job list itself lives in jobs.json in your GitHub repo (see index.html) so everyone sees the same jobs. */
(function (g) {
  'use strict';

  /* ---------- local storage: small IndexedDB store for personal, per-device data ---------- */
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

  /* ---------- reminders (computed locally per device from the shared job list) ---------- */
  function times(j) {
    const dl = deadlineAt(j);
    let d0 = at(j.d, j.rt || '09:00');
    if (d0 >= dl) d0 = new Date(dl.getTime() - 30 * 60000);
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

  function evaluate(jobs, fired, now) {
    const fire = [], skip = [];
    for (const j of jobs) {
      if (j.applied || now > deadlineAt(j)) continue;
      const t = times(j);
      const k0 = j.id + '|d0', k1 = j.id + '|d1';
      const due0 = now >= t.d0 && !fired[k0];
      const due1 = now >= t.d1 && !fired[k1];
      if (due0) { fire.push({ job: j, kind: 'd0' }); if (due1) skip.push(k1); }
      else if (due1) fire.push({ job: j, kind: 'd1' });
    }
    return { fire, skip };
  }

  // jobs: the current shared list (from jobs.json on GitHub, held in memory by the page).
  async function runDue(jobs, show) {
    if (!jobs || !jobs.length) return [];
    const now = new Date();
    const fired = (await get('fired')) || {};
    const { fire, skip } = evaluate(jobs, fired, now);
    if (!fire.length && !skip.length) return [];
    const out = [];
    await update('fired', cur => {
      cur = cur || {};
      for (const k of skip) if (!cur[k]) cur[k] = { t: +now, skip: 1 };
      for (const f of fire) {
        const key = f.job.id + '|' + f.kind;
        if (cur[key]) continue;
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

  g.LD = { get, set, update, clear, pad, at, shiftDay, todayStr, deadlineAt, daysLeft, fmtTime, dateLabel, times, message, evaluate, runDue, setFired, clearFired };
})(typeof self !== 'undefined' ? self : window);