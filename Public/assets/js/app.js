// ===== Auto Year =====
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

/* -------------------- Quote form -------------------- */
document.getElementById('quoteForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    // Auto-detect backend base URL (works locally + after deployment)
const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:5000"
    : ""; // use same origin in production

const r = await fetch(`${API_BASE}/api/quote`, {

      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const out = await r.json();
    if (out.ok) {
      iziToast.success({ title: 'Success', message: 'Quote submitted! Ref: ' + out.id });
      e.target.reset();
    } else {
      iziToast.error({ title: 'Error', message: out.errors?.join(', ') || 'Try again' });
    }
  } catch {
    iziToast.error({ title: 'Network', message: 'Please try again later.' });
  }
});

/* -------------------- Tracking -------------------- */
document.querySelectorAll('form[data-result]').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = new FormData(form).get('trackingId');
    const resSel = form.getAttribute('data-result');
    const sumSel = form.getAttribute('data-summary');
    const resEl = resSel ? document.querySelector(resSel) : null;
    const sumEl = sumSel ? document.querySelector(sumSel) : null;
    if (!resEl) return;
    resEl.textContent = 'Loading...';
    if (sumEl) sumEl.textContent = '';
    try {
    const r = await fetch(`/api/track/${encodeURIComponent(id)}`);
      const out = await r.json();
      if (!out.ok) {
        resEl.textContent = 'Not found.';
        iziToast.error({ title: 'Tracking', message: 'ID not found' });
        return;
      }
      const d = out.data || {};
      if (out.stale) fetch(`/api/track/${encodeURIComponent(id)}/nudge`, { method: 'POST' }).catch(() => { });

      if (sumEl) {
        const parts = [
          d.origin && d.destination ? `${d.origin} → ${d.destination}` : '',
          d.cargo ? `Cargo: ${d.cargo}` : '',
          d.driver ? `Driver: ${d.driver}` : '',
        ].filter(Boolean);
        sumEl.textContent = parts.join(' • ');
      }

      const cp = (d.checkpoints || []).sort((a, b) => new Date(a.at) - new Date(b.at));
      resEl.innerHTML = cp
        .map(s => `<li><strong>${new Date(s.at).toLocaleString()}</strong> — ${s.text}</li>`)
        .join('');
    } catch {
      resEl.textContent = 'Could not fetch tracking info.';
      iziToast.error({ title: 'Network', message: 'Could not fetch tracking info' });
    }
  });
});

/* -------------------- Worker Login Modal -------------------- */
(function () {
  const openBtns = document.querySelectorAll('[data-open-login]');
  const scrim = document.getElementById('loginScrim');
  const modal = document.getElementById('loginModal');
  const closeBtn = modal?.querySelector('[data-close-login]');
  if (!openBtns.length || !scrim || !modal) return;

  function open() {
    scrim.hidden = false;
    modal.hidden = false;
    document.body.classList.add('no-scroll');
  }
  function close() {
    scrim.hidden = true;
    modal.hidden = true;
    document.body.classList.remove('no-scroll');
  }
  openBtns.forEach(b => b.addEventListener('click', open));
  scrim.addEventListener('click', close);
  closeBtn?.addEventListener('click', close);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();
