function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- theme ----------
function setupTheme() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  btn.textContent = isLight ? '☀️' : '🌙';
  btn.addEventListener('click', () => {
    const nowLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (nowLight) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'dark');
      btn.textContent = '🌙';
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('theme', 'light');
      btn.textContent = '☀️';
    }
  });
}
setupTheme();

// ---------- auth gate ----------
async function checkAuth() {
  const { isAdmin } = await fetch('/api/admin-check').then((r) => r.json());
  document.getElementById('loginScreen').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('adminScreen').style.display = isAdmin ? 'block' : 'none';
  if (isAdmin) loadEntries();
  return isAdmin;
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const password = document.getElementById('passwordInput').value;
  const res = await fetch('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    checkAuth();
  } else {
    document.getElementById('loginError').textContent = 'Wrong password.';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin-login', { method: 'DELETE' });
  location.reload();
});

// ---------- notify all subscribers (manual broadcast) ----------
document.getElementById('notifyAllBtn').addEventListener('click', async () => {
  const btn = document.getElementById('notifyAllBtn');
  const statusEl = document.getElementById('notifyStatus');
  const message = document.getElementById('notifyMessage').value;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Sending…';
  statusEl.innerHTML = '<div class="board-sub">Sending…</div>';
  try {
    const res = await fetch('/api/notify-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.innerHTML = `<div class="error">Error: ${escapeHtml(data.error)}</div>`;
      return;
    }
    if (data.message) {
      statusEl.innerHTML = `<div class="board-sub">${escapeHtml(data.message)}</div>`;
    } else {
      statusEl.innerHTML = `<div class="board-sub">Sent to ${data.sent} subscriber(s).${data.failed ? ` ${data.failed} failed.` : ''}</div>`;
    }
    document.getElementById('notifyMessage').value = '';
  } catch (e) {
    statusEl.innerHTML = `<div class="error">Failed: ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

// ---------- paste + AI parse ----------
document.getElementById('parseBtn').addEventListener('click', async () => {
  const text = document.getElementById('pasteText').value;
  if (!text.trim()) return toast('Paste some email text first.');

  const preview = document.getElementById('parsePreview');
  preview.innerHTML = '<div class="board-sub">Extracting…</div>';

  const res = await fetch('/api/parse-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok) {
    preview.innerHTML = `<div class="error">${escapeHtml(data.error)}</div>`;
    return;
  }

  if (data.type === 'unknown') {
    preview.innerHTML = `
      <div class="board-sub">Couldn't detect a job or exam in this text. Fill the form manually below, or try different text.</div>
      <button type="button" id="parseAgainBtn" style="margin-top:8px">Try different text</button>`;
    document.getElementById('parseAgainBtn').addEventListener('click', () => {
      document.getElementById('pasteText').value = '';
      preview.innerHTML = '';
      document.getElementById('pasteText').focus();
    });
    return;
  }

  // Pre-fill the manual form so the admin can review/edit before saving.
  document.getElementById('f_type').value = data.type;
  document.getElementById('f_status').value = data.status || (data.type === 'exam' ? 'scheduled' : 'applied');
  document.getElementById('f_title').value = data.title || '';
  document.getElementById('f_org').value = data.organization || '';
  document.getElementById('f_date').value = data.event_date || '';
  document.getElementById('f_notes').value = data.notes || '';

  preview.innerHTML = `
    <div class="board-sub">Extracted via ${escapeHtml(data.method)} — review the form below, then click Save entry.</div>
    <button type="button" id="parseAgainBtn" style="margin-top:8px">Try different text instead</button>`;
  document.getElementById('parseAgainBtn').addEventListener('click', () => {
    document.getElementById('pasteText').value = '';
    preview.innerHTML = '';
    document.getElementById('pasteText').focus();
  });
  document.getElementById('entryForm').scrollIntoView({ behavior: 'smooth' });
});

// ---------- manual entry form ----------
document.getElementById('entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('entryId').value;
  const body = {
    type: document.getElementById('f_type').value,
    status: document.getElementById('f_status').value,
    title: document.getElementById('f_title').value,
    organization: document.getElementById('f_org').value,
    event_date: document.getElementById('f_date').value,
    notes: document.getElementById('f_notes').value,
    notify_message: document.getElementById('f_notify_msg').value,
  };
  if (!body.title || !body.event_date) return toast('Title and date are required.');

  const isEdit = !!id;
  const res = await fetch('/api/entries', {
    method: isEdit ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(isEdit ? { ...body, id, reviewed: true } : body),
  });
  if (!res.ok) return toast('Save failed.');
  const saved = await res.json();

  if (isEdit) {
    toast('Entry updated.');
  } else if (saved.notified) {
    toast(`Entry published — notified ${saved.notified.sent} subscriber(s).`);
  } else {
    toast('Entry published.');
  }
  clearForm();
  loadEntries();
});

document.getElementById('clearFormBtn').addEventListener('click', clearForm);
function clearForm() {
  document.getElementById('entryForm').reset();
  document.getElementById('entryId').value = '';
  document.getElementById('parsePreview').innerHTML = '';
  document.getElementById('pasteText').value = '';
  document.getElementById('f_notify_msg').value = '';
}

// ---------- entry list ----------
let allEntries = [];
let searchTerm = '';

function entryRowHtml(e) {
  return `
    <div class="admin-entry-row" data-id="${e.id}">
      <div class="row-top">
        <div>
          <span class="tag ${e.type}">${e.type}</span>
          ${!e.reviewed ? '<span class="pending-badge">NEEDS REVIEW</span>' : ''}
          <div class="flap-title">${escapeHtml(e.title)}</div>
          <div class="flap-org">${escapeHtml(e.organization || '')} ${e.event_date ? '· ' + e.event_date.slice(0, 10) : '· no date set'} · ${escapeHtml(e.status || '')}</div>
          ${e.notes ? `<div class="flap-notes">${escapeHtml(e.notes)}</div>` : ''}
        </div>
        <div class="row-actions">
          <button data-edit="${e.id}">Edit</button>
          ${!e.reviewed ? `<button data-confirm="${e.id}" class="primary">Confirm</button>` : ''}
          <button data-delete="${e.id}" class="danger">Delete</button>
        </div>
      </div>
    </div>`;
}

function wireRowActions(container, entries) {
  container.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const entry = entries.find((x) => x.id == btn.dataset.edit);
      document.getElementById('entryId').value = entry.id;
      document.getElementById('f_type').value = entry.type;
      document.getElementById('f_status').value = entry.status || 'applied';
      document.getElementById('f_title').value = entry.title;
      document.getElementById('f_org').value = entry.organization || '';
      document.getElementById('f_date').value = entry.event_date ? entry.event_date.slice(0, 10) : '';
      document.getElementById('f_notes').value = entry.notes || '';
      document.getElementById('entryForm').scrollIntoView({ behavior: 'smooth' });
    })
  );

  container.querySelectorAll('[data-confirm]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await fetch('/api/entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: btn.dataset.confirm, reviewed: true }),
      });
      toast('Confirmed.');
      loadEntries();
    })
  );

  // Two-step inline delete confirm instead of a jarring native confirm() dialog:
  // first click arms it ("Delete?" in red), second click within 4s deletes it,
  // clicking elsewhere or waiting disarms it.
  container.querySelectorAll('[data-delete]').forEach((btn) => {
    let armed = false;
    let resetTimer = null;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Delete?';
        btn.classList.add('confirming');
        resetTimer = setTimeout(() => {
          armed = false;
          btn.textContent = 'Delete';
          btn.classList.remove('confirming');
        }, 4000);
        return;
      }
      clearTimeout(resetTimer);
      await fetch(`/api/entries?id=${btn.dataset.delete}`, { method: 'DELETE' });
      toast('Deleted.');
      loadEntries();
    });
  });
}

function renderEntryLists() {
  const list = document.getElementById('entryList');

  // Every entry saved from here on is published immediately, so there's no
  // separate review queue — this just shows everything in one list. (The
  // per-row "Confirm" button in entryRowHtml still applies to any leftover
  // entry from before this update that was never confirmed.)
  const term = searchTerm.trim().toLowerCase();
  let visible = allEntries;
  if (term) {
    visible = visible.filter(
      (e) =>
        (e.title || '').toLowerCase().includes(term) ||
        (e.organization || '').toLowerCase().includes(term)
    );
  }
  visible = [...visible].sort((a, b) => new Date(a.event_date || '9999-12-31') - new Date(b.event_date || '9999-12-31'));

  if (!visible.length) {
    list.innerHTML = `<div class="board-sub">${term ? 'No entries match your search.' : 'No entries yet.'}</div>`;
    return;
  }
  list.innerHTML = visible.map(entryRowHtml).join('');
  wireRowActions(list, allEntries);
}

document.getElementById('entrySearch').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  renderEntryLists();
});

async function loadEntries() {
  const list = document.getElementById('entryList');
  list.innerHTML = '<div class="loading-row">Loading entries…</div>';
  try {
    allEntries = await fetch('/api/entries').then((r) => r.json());
  } catch (e) {
    list.innerHTML = '<div class="board-sub">Couldn\'t load entries. Try refreshing.</div>';
    return;
  }
  if (!allEntries.length) {
    list.innerHTML = '<div class="board-sub">No entries yet.</div>';
    return;
  }
  renderEntryLists();
}

checkAuth();