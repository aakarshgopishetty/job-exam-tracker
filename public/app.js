// ---------- helpers ----------
function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function countdownLabel(days) {
  if (days < 0) return { text: 'PAST', small: `${Math.abs(days)}D AGO` };
  if (days === 0) return { text: 'TODAY', small: '' };
  if (days === 1) return { text: '1', small: 'DAY' };
  return { text: String(days), small: 'DAYS' };
}

// ---------- filter state ----------
let currentFilter = 'all'; // 'all' | 'job' | 'exam'
let hidePast = true;
let lastEntries = [];

// ---------- render board ----------
async function loadBoard() {
  const board = document.getElementById('board');
  try {
    const res = await fetch('/api/entries');
    const entries = await res.json();
    lastEntries = entries;
    renderBoard();
  } catch (e) {
    board.innerHTML = '<div class="empty-state">Couldn\'t load the board. Try refreshing.</div>';
  }
}

function renderBoard() {
  const board = document.getElementById('board');
  let withDates = lastEntries.filter((e) => e.event_date);

  if (currentFilter !== 'all') {
    withDates = withDates.filter((e) => e.type === currentFilter);
  }
  if (hidePast) {
    withDates = withDates.filter((e) => daysUntil(e.event_date.slice(0, 10)) >= 0);
  }

  withDates.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  if (!withDates.length) {
    board.innerHTML = '<div class="empty-state">No upcoming deadlines match this view.</div>';
    return;
  }

  board.innerHTML = withDates
    .map((e) => {
      const dateOnly = e.event_date.slice(0, 10);
      const days = daysUntil(dateOnly);
      const cd = countdownLabel(days);
      const urgency = days <= 0 ? 'today' : days <= 3 ? 'urgent' : days <= 7 ? 'soon' : '';
      const dateFmt = new Date(dateOnly + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      return `
        <div class="flap-row ${e.type} ${urgency}">
          <div class="flap-countdown">${cd.text}${cd.small ? `<small>${cd.small}</small>` : ''}</div>
          <div class="flap-info">
            <div class="flap-title">${escapeHtml(e.title)}</div>
            ${e.organization ? `<div class="flap-org">${escapeHtml(e.organization)}</div>` : ''}
            ${e.notes ? `<div class="flap-notes">${escapeHtml(e.notes)}</div>` : ''}
          </div>
          <div class="tag ${e.type}">${e.type}</div>
          <div class="flap-date">${dateFmt}</div>
        </div>`;
    })
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- filter controls ----------
function setupFilters() {
  const tabs = document.getElementById('filterTabs');
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-tab');
    if (!btn) return;
    tabs.querySelectorAll('.filter-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderBoard();
  });

  const hidePastToggle = document.getElementById('hidePastToggle');
  hidePastToggle.addEventListener('change', () => {
    hidePast = hidePastToggle.checked;
    renderBoard();
  });
}

// ---------- clock ----------
function tickClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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

// ---------- push notifications ----------
async function setupNotifications() {
  const btn = document.getElementById('notifyBtn');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    btn.disabled = true;
    btn.textContent = '🔕 Notifications not supported';
    return;
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  let existing = await reg.pushManager.getSubscription();
  updateNotifyButton(existing);

  btn.addEventListener('click', async () => {
    existing = await reg.pushManager.getSubscription();

    // Already subscribed -> this click means "turn off".
    if (existing) {
      try {
        await fetch('/api/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
      } catch (e) {
        // even if the server call fails, still unsubscribe locally so the
        // button state doesn't lie to the user
        await existing.unsubscribe();
      }
      updateNotifyButton(null);
      toast('Notifications turned off on this device.');
      return;
    }

    if (Notification.permission === 'denied') {
      toast('Notifications are blocked in your browser settings.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Permission not granted.');
      return;
    }

    const { key } = await fetch('/api/vapid-public-key').then((r) => r.json());
    if (!key) {
      toast('Server not configured for push yet.');
      return;
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });

    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });

    updateNotifyButton(sub);
    toast('You\'ll get reminders 3 days, 1 day, and on the day.');
  });
}

function updateNotifyButton(sub) {
  const btn = document.getElementById('notifyBtn');
  if (sub) {
    btn.textContent = '🔔 Notifications on (tap to turn off)';
    btn.classList.add('primary');
  } else {
    btn.textContent = '🔔 Enable notifications';
    btn.classList.remove('primary');
  }
}

// ---------- init ----------
setupTheme();
setupFilters();
loadBoard();
setInterval(loadBoard, 60000);
// Refetch instantly when the tab regains focus instead of waiting up to 60s.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadBoard();
});
tickClock();
setInterval(tickClock, 30000);
setupNotifications();
