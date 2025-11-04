// workers.js

// ---------- Auth helpers ----------
function getToken(){ return localStorage.getItem('token') || ''; }
function getRole(){ return localStorage.getItem('role') || ''; }
const TRACK_BASE = '/api/track-secure';

function authHeaders(extra = {}) {
  const h = { ...extra };   // ✅ not ".extra"
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}
// workers.js (near top helpers)
function setBusy(btn, on=true, txt='Working…'){
  if (!btn) return ()=>{};
  const old = btn.textContent;
  btn.disabled = !!on;
  btn.textContent = on ? txt : old;
  return ()=>{ btn.disabled=false; btn.textContent=old; };
}


// ---------- UI refs ----------
const $ = sel => document.querySelector(sel);
const authGate = $('#authGate');
const app      = $('#app');
const logoutBtn = $('#logoutBtn');

const panel   = $('#panel');
const timeline = $('#timeline');
const tidHead = $('#tidHead');

const recentList = $('#recentList');
const inviteBox  = $('#inviteBox');
// ------------- Mini Router (hash-based) -------------
const routes = {
  new:       'view-new',
  find:      'view-find',
  recent:    'view-recent',
  shipment:  'view-shipment',
  dn:        'view-dn',
  supervision:'view-supervision',
  invite:     'view-invite'
};

function activeRoleAllows(link){
  const need = (link.getAttribute('data-role')||'').split(',').map(s=>s.trim()).filter(Boolean);
  if (!need.length) return true;
  return need.includes(getRole());
}

function setActiveNav(hashKey){
  document.querySelectorAll('.wkr-nav a').forEach(a=>{
    a.removeAttribute('aria-current');
    if (!activeRoleAllows(a)) { a.classList.add('soft'); a.setAttribute('aria-disabled','true'); a.tabIndex = -1; }
    else { a.classList.remove('soft'); a.removeAttribute('aria-disabled'); a.removeAttribute('tabindex'); }
    if ((a.dataset.route||'') === hashKey) a.setAttribute('aria-current','page');
  });
}

function showView(key){
  const id = routes[key] || routes['new'];
  document.querySelectorAll('.view').forEach(v => v.hidden = true);
  const el = document.getElementById(id);
  if (el) el.hidden = false;
  setActiveNav(key);
}

function parseHash(){
  // #/shipment/TRZ-... → { key:'shipment', param:'TRZ-...' }
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [key, param] = h.split('/'); 
  return { key: key || 'new', param };
}

async function handleRoute(){
  if (!requireAuth()) return;
  const { key, param } = parseHash();

  // restrict certain pages by role
  if ((key==='supervision' && !['admin','it'].includes(getRole())) ||
      (key==='invite' && getRole()!=='it')) {
    iziToast.error({ title:'Access', message:'Not allowed for your role' });
    return showView('new');
  }

  // only show default views right away
  if (key !== 'shipment') showView(key);

  if (key === 'shipment' && param) {
    // show loading placeholder (optional)
    tidHead.textContent = 'Loading...';
    timeline.innerHTML = '<li class="warn">Loading shipment...</li>';
    const ok = await load(param);
    if (!ok) {
      // revert view on fail
      showView('find');
      return;
    }
  }

  if (key === 'recent') await loadRecent();
}

window.addEventListener('hashchange', handleRoute);

// ---------- utils ----------
// workers.js (add near utils)
function timeAgo(dt){
  const s = Math.floor((Date.now()-new Date(dt).getTime())/1000);
  const m = Math.floor(s/60), h=Math.floor(m/60), d=Math.floor(h/24);
  if (isNaN(s)) return '';
  if (d>0) return `${d}d ago`; if (h>0) return `${h}h ago`; if (m>0) return `${m}m ago`;
  return 'just now';
}

// Keep a copy for filtering/export
let _recentRows = [];

// replace loadRecent() with the version below
async function loadRecent(limit = 50){
  try{
    const q = encodeURIComponent(document.getElementById('recentSearch')?.value || '');
    const status = encodeURIComponent(document.getElementById('recentStatus')?.value || '');
    const url = `/api/track?limit=${limit}${q?`&q=${q}`:''}${status?`&status=${status}`:''}`;

    const r = await fetch(url, { headers: authHeaders() });
    const out = await r.json();
    if(!out.ok) throw 0;
    _recentRows = out.data || [];
    renderRecent(); // now renderRecent() just renders, no client-side filter needed
  }catch{
    recentList.innerHTML = `<li class="warn">Recent list unavailable.</li>`;
  }
}

function renderRecent(){
  recentList.innerHTML = (_recentRows||[]).map(d => `
    <li>
      <div>
        <strong><a href="#" data-open-id="${d.trackingId}" title="Open in panel">${d.trackingId}</a></strong>
        — ${d.origin||'?'} → ${d.destination||'?'}
      </div>
      <small>
        ${d.driver ? `Driver: ${d.driver}` : ''}${d.vehicle ? ` • ${d.vehicle}`:''}
        ${d.lastStatus ? ` • Status: ${d.lastStatus}` : ''}
        ${d.lastStatusAt ? ` • ${timeAgo(d.lastStatusAt)}` : (d.updatedAt ? ` • Updated ${timeAgo(d.updatedAt)}` : '')}
      </small>
    </li>
  `).join('') || `<li class="warn">No records yet.</li>`;

  recentList.querySelectorAll('[data-open-id]').forEach(a=>{
    a.addEventListener('click', (e)=>{
  e.preventDefault();
  location.hash = `#/shipment/${encodeURIComponent(a.dataset.openId)}`;
});

  });
}
document.getElementById('recentSearch')?.addEventListener('input', ()=>loadRecent());
document.getElementById('recentStatus')?.addEventListener('change', ()=>loadRecent());
document.getElementById('recentClear')?.addEventListener('click', ()=>{
  document.getElementById('recentSearch').value = '';
  document.getElementById('recentStatus').value = '';
  loadRecent();
});
// hook up controls


function fmt(dt){ try{ return new Date(dt).toLocaleString(); }catch{ return dt; } }
function iconFor(i){
  switch(i){
    case 'label': return 'fa-tag';
    case 'pickup': return 'fa-person-carry-box';
    case 'transit': return 'fa-truck-moving';
    case 'out': return 'fa-truck-fast';
    case 'done': return 'fa-check';
    default: return 'fa-circle';
  }
}


function requireAuth(){
  if (!getToken()){
     if (app) app.hidden = true;
    if (logoutBtn) logoutBtn.hidden = true;
    // if you ever add an invite box container later:
    const inviteBox = document.getElementById('inviteBox');
    if (inviteBox) inviteBox.hidden = true;
    if (authGate) authGate.hidden = false;
    return false;
  }
  return true;
}

// ---------- Login flow ----------
$('#loginForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try{
   const r = await fetch('/api/auth/login', {
  method:'POST',
  headers:{ 'Content-Type':'application/json' },
  body: JSON.stringify(data),
  credentials: 'include' // <-- ensure cookie is set across origins
});
    const out = await r.json();
    if(!out.ok) throw new Error(out.message||'Invalid credentials');
    localStorage.setItem('token', out.token);
    localStorage.setItem('role', out.role||'worker');
    iziToast.success({ title:'Signed in', message:data.email });
   if (out.forcePasswordChange) {
  $('#pwChange').hidden = false;
  // ensure app stays hidden
  app.hidden = true;
  iziToast.info({ title:'Action needed', message:'Please change your password' });
} else {
  localStorage.setItem('displayName', out.displayName || '');
  showApp();
}
  }catch(err){
    iziToast.error({ title:'Login', message: err.message || 'Failed to sign in' });
  }
});

$('#pwForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const newPassword = fd.get('newPassword');
  const displayName = fd.get('displayName'); // 👈 NEW
  try{
    const r = await fetch('/api/auth/change-password', {
      method:'POST',
      headers: authHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify({ newPassword, displayName }) // 👈 NEW
    });
    const out = await r.json();
    if(!out.ok) throw new Error(out.message||'Could not change');
    localStorage.setItem('displayName', out.displayName || '');
    iziToast.success({ title:'Password', message:'Updated' });
    showApp();
  }catch(err){
    iziToast.error({ title:'Password', message: err.message || 'Error' });
  }
});

logoutBtn?.addEventListener('click', ()=>{
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  iziToast.info({ title:'Signed out', message:'See you!' });
  location.href = '/';
});

// ---------- Tracking fetch/render ----------
let currentId = '';

async function fetchTracking(id){
  const r = await fetch(`/api/track/${encodeURIComponent(id)}`, { headers: authHeaders() });
  const out = await r.json();
  return out.ok ? out.data : null;
}
function renderTimeline(checkpoints){
  timeline.__data = checkpoints || [];
  if (!checkpoints?.length){
    timeline.innerHTML = '<li class="warn">No checkpoints yet.</li>';
    return;
  }
  const cp = checkpoints.slice().sort((a,b)=>new Date(a.at)-new Date(b.at));
  timeline.innerHTML = cp.map(s => `
    <li data-icon="${s.icon}">
      <div><span class="badge"><i class="fa-solid ${iconFor(s.icon)}"></i></span>
        <strong>${s.text || '(no note)'}</strong>
      </div>
      <small>${fmt(s.at)}${s.location ? ' • ' + s.location : ''}</small>
    </li>
  `).join('');
}


// ---------- Create shipment ----------
$('#newForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!requireAuth()) return;
  const payload = Object.fromEntries(new FormData(e.target).entries()); // <-- put this back
  const done = setBusy(e.submitter, true, 'Creating…'); // NEW
  try{
    const r = await apiFetch(`${TRACK_BASE}`, {
      method:'POST',
      headers: authHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify(payload)
    });
    const out = await r.json();
    if(!out.ok) throw new Error(out.message||'Could not create');
    const id = out.id;
navigator.clipboard?.writeText(id).catch(()=>{});
iziToast.success({ title:'Created', message:`Tracking ID ${id} (copied)` });
location.hash = `#/shipment/${encodeURIComponent(id)}`;
    $('#trackingId').value = id;
    await load(id);
    await loadRecent();
    e.target.reset();
  }catch(err){
    iziToast.error({ title:'Create', message: err.message || 'Server error' });
  }finally{
    done(); // NEW
  }
});
$('#copyIdBtn')?.addEventListener('click', ()=>{
  const v = tidHead.textContent || '';
  if (!v) return;
  navigator.clipboard.writeText(v)
    .then(()=> iziToast.success({title:'Copied', message:'Tracking ID'}))
    .catch(()=> iziToast.error({title:'Copy', message:'Could not copy'}));
});
// ---------- Append checkpoint ----------
$('#addForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!requireAuth()) return;
  if (!currentId) return iziToast.error({ title:'Checkpoint', message:'Load or create a shipment first' });

  const payload = Object.fromEntries(new FormData(e.target).entries());
  const done = setBusy(e.submitter, true, 'Adding…'); // NEW

  // optimistic render
  const optimistic = { at: new Date().toISOString(), text: payload.text || payload.icon, icon: payload.icon };
  const prevHtml = timeline.innerHTML;
  renderTimeline([...(timeline.__data||[]), optimistic]); // store data on element
  try{
    const r = await fetch(`${TRACK_BASE}/${encodeURIComponent(currentId)}/checkpoints`, {

      method:'POST',
      headers: authHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify(payload)
    });
    const out = await r.json();
    if(!out.ok) throw new Error(out.message||'Could not add checkpoint');
    iziToast.success({ title:'Updated', message:'Checkpoint added' });
    e.target.reset();
    await load(currentId);
    await loadRecent();
  }catch(err){
    timeline.innerHTML = prevHtml; // revert on failure
    iziToast.error({ title:'Update', message: err.message || 'Server error' });
  }finally{
    done();
  }
});

// ---------- Find existing ----------
$('#findForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = new FormData(e.target).get('trackingId');
  location.hash = `#/shipment/${encodeURIComponent(id)}`;
  await load(id);
});

// ---------- Recent shipments (if backend list route exists) ----------


// ---------- Invite worker (IT only) ----------
$('#inviteForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (getRole()!=='it') return iziToast.error({ title:'Invite', message:'Only IT can invite' });
  try{
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const r = await fetch('/api/users/invite', {
      method:'POST',
      headers: authHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify(payload)
    });
    const out = await r.json();
    if(!out.ok) throw new Error(out.message||'Failed');
    iziToast.success({ title:'Invited', message:`${out.email} (${out.role})` });
    e.target.reset();
  }catch(err){
    iziToast.error({ title:'Invite', message: err.message || 'Server error' });
  }
});

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', ()=>{
  if (getToken()){
    showApp();
  } else {
    requireAuth();
  }
  handleRoute(); // <-- run once on load
});
// ------------------- Delivery Notes Pack -------------------
(function(){
  const U = window.jspdf ? window.jspdf.jsPDF : null;
  if (!U) return; // jsPDF not loaded? bail quietly

  // UI
  const csvInput     = document.getElementById('dnCsv');
  const previewBtn   = document.getElementById('dnPreviewBtn');
  const buildBtn     = document.getElementById('dnBuildBtn');
  // drag & drop (inside the IIFE so it sees normalizeRow/renderTable/rows/buildBtn)
const dropZone = document.getElementById('dnPack');
function handleFile(f){
  Papa.parse(f, {
    header:true, skipEmptyLines:true,
    complete: (res)=>{ 
      rows = (res.data||[]).map(normalizeRow).filter(r=> r.trackingId || r.facility || r.address);
      if(!rows.length) return iziToast.error({ title:'CSV', message:'No usable rows' });
      renderTable(rows); buildBtn.disabled=false;
      iziToast.success({ title:'CSV', message:`Loaded ${rows.length} row(s)` });
    },
    error: ()=> iziToast.error({ title:'CSV', message:'Could not parse file' })
  });
}
['dragover','drop'].forEach(ev => dropZone?.addEventListener(ev, (e)=>{
  e.preventDefault();
  if (e.type==='drop'){ const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }
}));

  const table        = document.getElementById('dnPreview');
  const defaultOrigin= document.getElementById('dnDefaultOrigin');
  const defaultDriver= document.getElementById('dnDefaultDriver');

  // restore defaults
  defaultOrigin.value = localStorage.getItem('dn_default_origin') || '';
  defaultDriver.value = localStorage.getItem('dn_default_driver') || '';
  [defaultOrigin, defaultDriver].forEach(inp=>{
    inp?.addEventListener('change', ()=>{
      localStorage.setItem('dn_default_origin', defaultOrigin.value || '');
      localStorage.setItem('dn_default_driver', defaultDriver.value || '');
    });
  });

  let rows = [];

  function normalizeRow(r){
    // flexible keys (case-insensitive)
    const get = k => r[k] ?? r[k?.toLowerCase?.()] ?? r[k?.toUpperCase?.()];
    return {
      trackingId: String(get('trackingId')||'').trim(),
      date:       String(get('date')||'').trim(),
      customer:   String(get('customer')||'').trim(),
      facility:   String(get('facility')||'').trim(),
      lga:        String(get('lga')||'').trim(),
      state:      String(get('state')||'').trim(),
      items:      String(get('items')||'').trim(), // free text or name1|name2...
      qty:        String(get('qty')||'').trim(),
      vehicle:    String(get('vehicle')||'').trim(),
      driver:     String(get('driver')||'').trim() || defaultDriver.value,
      phone:      String(get('phone')||'').trim(),
      address:    String(get('address')||'').trim(),
      remarks:    String(get('remarks')||'').trim(),
      origin:     defaultOrigin.value
    };
  }

  function renderTable(rows){
    if (!table) return;
    const head = `
    <thead style="background:#f5f8ff">
      <tr>
        <th style="text-align:left;padding:8px">#</th>
        <th style="text-align:left;padding:8px">Tracking</th>
        <th style="text-align:left;padding:8px">Facility</th>
        <th style="text-align:left;padding:8px">Items</th>
        <th style="text-align:left;padding:8px">Qty</th>
        <th style="text-align:left;padding:8px">LGA</th>
        <th style="text-align:left;padding:8px">State</th>
      </tr>
    </thead>`;
    const body = rows.map((r,i)=>`
      <tr style="border-top:1px solid #e8eef7">
        <td style="padding:6px">${i+1}</td>
        <td style="padding:6px">${r.trackingId||'-'}</td>
        <td style="padding:6px">${r.facility||'-'}</td>
        <td style="padding:6px">${r.lga||'-'}</td>
        <td style="padding:6px">${r.state||'-'}</td>
        <td style="padding:6px">${r.items||'-'}</td>
        <td style="padding:6px">${r.qty||'-'}</td>
      </tr>`).join('');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
  }

  previewBtn?.addEventListener('click', ()=>{
    const f = csvInput?.files?.[0];
    if (!f) return iziToast.error({ title:'CSV', message:'Choose a CSV file' });
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (res)=>{
        rows = (res.data||[]).map(normalizeRow).filter(r => r.trackingId || r.facility || r.address);
        if (!rows.length) return iziToast.error({ title:'CSV', message:'No usable rows' });
        renderTable(rows);
        buildBtn.disabled = false;
        iziToast.success({ title:'CSV', message:`Loaded ${rows.length} row(s)` });
      },
      error: ()=> iziToast.error({ title:'CSV', message:'Could not parse file' })
    });
  });

  async function qrDataUrl(text){
    return await new Promise((resolve,reject)=>{
      QRCode.toDataURL(text||'', { width: 96, margin: 0 }, (err, url)=>{
        if (err) reject(err); else resolve(url);
      });
    });
  }

  function drawHeader(doc){
    doc.setFont('helvetica','bold');
    doc.setTextColor(20,40,80); // blue-ish title
    doc.setFontSize(16);
    doc.text('TRETIZE ROYALE LOGISTICS', 14, 16);
    doc.setFontSize(11);
    doc.setFont('helvetica','normal');
    doc.setTextColor(60,70,90);
    doc.text('Delivery Note', 14, 24);
    // thin divider
    doc.setDrawColor(230,235,246);
    doc.line(14, 28, 200, 28);
  }

  async function buildPdf(row){
    const doc = new U({ unit:'mm', format:'a4' });
    drawHeader(doc);
    let y = 34;

    // QR for tracking (top-right)
    if (row.trackingId){
      const url = await qrDataUrl(row.trackingId);
      doc.addImage(url, 'PNG', 170, 14, 26, 26);
    }

    // Meta grid
    doc.setFontSize(10);
    doc.setTextColor(30,35,45);
    const meta = [
      ['Tracking ID', row.trackingId || '-'],
      ['Date',        row.date || new Date().toLocaleDateString()],
      ['Customer',    row.customer || '-'],
      ['Origin',      row.origin || '-'],
      ['Facility',    row.facility || '-'],
      ['Address',     row.address || '-'],
      ['LGA / State', [row.lga,row.state].filter(Boolean).join(', ') || '-'],
      ['Driver / Phone', [row.driver,row.phone].filter(Boolean).join(' / ') || '-'],
      ['Vehicle',     row.vehicle || '-'],
      ['Remarks',     row.remarks || '-']
    ];
    // 2-column layout
    meta.forEach(([k,v])=>{
      doc.setFont('helvetica','bold');  doc.text(k+':', 14, y);
      doc.setFont('helvetica','normal');doc.text(String(v), 54, y, { maxWidth: 140 });
      y += 6;
    });

    // Items table
    y += 3;
    const items = (row.items||'').split('|').map(s=>s.trim()).filter(Boolean);
    const body = items.length ? items.map((name,i)=>[i+1, name, '']) : [[1, row.items||'(no item)', row.qty||'']];
    doc.autoTable({
      startY: y,
      head: [['#','Item','Qty']],
      body,
      styles: { font:'helvetica', fontSize:10, cellPadding: 2 },
      headStyles: { fillColor:[229,236,255], textColor:[20,40,80] },
      theme: 'grid',
      tableWidth: 180,
      margin: { left:14, right:16 }
    });

    // Signatures
    const endY = doc.lastAutoTable.finalY || y + 10;
    const sigY = endY + 18;
    doc.setDrawColor(200,205,220);
    doc.line(14, sigY, 90, sigY);
    doc.line(110, sigY, 196, sigY);
    doc.setFontSize(9);
    doc.text('Issued by (Tretize Rep.)', 14, sigY + 5);
    doc.text('Received by (Client Rep.)', 110, sigY + 5);

    return doc.output('arraybuffer');
  }

  buildBtn?.addEventListener('click', async ()=>{
    if (!rows.length) return iziToast.error({ title:'Build', message:'Load CSV first' });
    buildBtn.disabled = true;
    buildBtn.textContent = 'Building…';
    try{
      const zip = new JSZip();
      // build each PDF
      for (let i=0; i<rows.length; i++){
        const r = rows[i];
        const buf = await buildPdf(r);
        const name = (r.trackingId || `note_${i+1}`).replace(/[^a-z0-9_\-]/gi,'_');
        zip.file(`${name}.pdf`, buf);
      }
      const blob = await zip.generateAsync({ type:'blob' });
      saveAs(blob, `delivery-notes_${new Date().toISOString().slice(0,10)}.zip`);
      iziToast.success({ title:'Done', message:`${rows.length} PDF(s) zipped` });
    }catch(err){
      console.error(err);
      iziToast.error({ title:'Build', message:'Could not build ZIP' });
    }finally{
      buildBtn.disabled = false;
      buildBtn.textContent = 'Build ZIP';
    }
  });
})();
// workers.js (keep your existing "Export (All)" click)
document.getElementById('exportCsvBtn')?.addEventListener('click', async () => {
  const a = document.createElement('a');
  a.href = '/api/track/export';
  a.download = 'shipments.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// NEW: export filtered view from _recentRows
document.getElementById('exportCsvFilteredBtn')?.addEventListener('click', ()=>{
  if (!_recentRows.length) return iziToast.error({title:'Export', message:'Nothing to export'});
  // apply the same render filter
  const q = (document.getElementById('recentSearch')?.value || '').toLowerCase().trim();
  const rows = _recentRows.filter(d=>{
    const hay = `${d.trackingId} ${d.origin} ${d.destination} ${d.driver} ${d.vehicle}`.toLowerCase();
    return !q || hay.includes(q);
  });
  if (!rows.length) return iziToast.error({title:'Export', message:'No rows after filter'});

  const csv = Papa.unparse(rows.map(r=>({
    trackingId: r.trackingId,
    origin: r.origin || '',
    destination: r.destination || '',
    driver: r.driver || '',
    vehicle: r.vehicle || '',
    updatedAt: r.updatedAt || ''
  })));
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  saveAs(blob, `shipments_filtered_${new Date().toISOString().slice(0,10)}.csv`);
});

// role gating for Supervision card
function showApp(){
  authGate.hidden = true;
  app.hidden = false;
  logoutBtn.hidden = false;

  // gate nav items by role
  const role = getRole();
  document.querySelectorAll('.wkr-nav a[data-role]').forEach(a=>{
    const allow = (a.getAttribute('data-role')||'').split(',').includes(role);
    if (!allow){ a.classList.add('soft'); a.setAttribute('aria-disabled','true'); a.tabIndex = -1; }
    else { a.classList.remove('soft'); a.removeAttribute('aria-disabled'); a.removeAttribute('tabindex'); }
  });
}

// keep track of loaded shipment to prefill edits
function fillEditForm(data){
  const f = $('#editForm');
  if(!f) return;
  ['driver','vehicle','weight','destination','phone','sender','receiver','origin','cargo','count','shipmentType']
    .forEach(name=>{
      const el = f.querySelector(`[name="${name}"]`);
      if (el && data[name] != null) el.value = data[name];
    });
}
// document.getElementById('hardReset')?.addEventListener('click', ()=>{
//   localStorage.removeItem('token');
//   localStorage.removeItem('role');
//   fetch('/api/auth/logout', { method:'POST', credentials:'include' }).finally(()=>{
//     location.reload();
//   });
// });
// fetch & render audit table
async function loadAudit(id){
  const t = $('#auditTable');
  if (!t) return;
  t.innerHTML = '<tbody><tr><td style="padding:8px">Loading audit…</td></tr></tbody>';
  try{
    const r = await fetch(`${TRACK_BASE}/${encodeURIComponent(id)}/audit`, { headers: authHeaders() });
    const out = await r.json();
    if(!out.ok) throw 0;
    const rows = out.data || [];
    const head = `<thead style="background:#f5f8ff"><tr>
      <th style="text-align:left;padding:8px">When</th>
      <th style="text-align:left;padding:8px">Actor</th>
      <th style="text-align:left;padding:8px">Role</th>
      <th style="text-align:left;padding:8px">Change / Note</th>
    </tr></thead>`;
    const body = rows.map(r=>{
      const when = new Date(r.createdAt).toLocaleString();
      const actor = (r.actorName || r.actorEmail || '—');
      const role = r.role || '—';
      let change = '';
      if (r.kind === 'admin_note') change = `<em>NOTE:</em> ${r.note}`;
      else change = (r.changes||[]).map(c=>`${c.field}: <code>${c.before ?? '—'}</code> → <code>${c.after ?? '—'}</code>`).join('<br/>') || '—';
      return `<tr style="border-top:1px solid #e8eef7">
        <td style="padding:6px">${when}</td>
        <td style="padding:6px">${actor}</td>
        <td style="padding:6px">${role}</td>
        <td style="padding:6px">${change}</td>
      </tr>`;
    }).join('');
    t.innerHTML = head + `<tbody>${body}</tbody>`;
  }catch{
    t.innerHTML = '<tbody><tr><td style="padding:8px;color:#b00">Audit unavailable</td></tr></tbody>';
  }
}

// extend load() to fill edit form + audit
async function load(id){
  const data = await fetchTracking(id);
  if (!data){
    iziToast.error({ title:'Tracking', message:'Shipment not found' });
    return false;  // 👈 return false for handleRoute
  }

  currentId = data.trackingId;
  showView('shipment');  // now runs only if data exists
  tidHead.textContent = currentId;
  renderTimeline(data.checkpoints || []);
  fillEditForm(data);
  loadAudit(currentId);
  document.querySelector('.wkr-nav a[data-route="shipment"]')?.classList.remove('soft');
  return true;  // 👈 success
}



// handle Save (role-based)
$('#editForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!requireAuth()) return;
  if (!currentId) return iziToast.error({ title:'Edit', message:'Load a shipment first' });

  const fd = new FormData(e.target);
  // send only non-empty fields to avoid accidental overwrites
  const body = {};
  for (const [k,v] of fd.entries()) if (String(v).trim()!=='') body[k]=v;

  const done = setBusy(e.submitter, true, 'Saving…');
  try{
    const r = await fetch(`${TRACK_BASE}/${encodeURIComponent(currentId)}`, {
      method:'PUT',
      headers: authHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify(body)
    });
    const out = await r.json();
    if(!out.ok) throw new Error(out.message||'Save failed');
    iziToast.success({ title:'Saved', message:'Shipment updated' });
    await load(currentId);     // reload details and audit
    await loadRecent();
  }catch(err){
    iziToast.error({ title:'Save', message: err.message || 'Server error' });
  }finally{
    done();
  }
});

// Admin note/nudge (email optional)
$('#adminNoteForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = $('#adminShipId').value.trim();
  const toEmail = $('#adminToEmail').value.trim();
  const note = $('#adminNote').value.trim();
  if (!id || !note) return;
  const btn = e.submitter;
  const done = setBusy(btn, true, 'Sending…');
  try{
    const r = await fetch(`${TRACK_BASE}/${encodeURIComponent(id)}/admin-note`,{
      method:'POST',
      headers: authHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify({ toEmail: toEmail || undefined, note })
    });
    const out = await r.json();
    if(!out.ok) throw new Error(out.message||'Failed');
    iziToast.success({ title:'Note sent', message: toEmail ? `Mailed ${toEmail}` : 'Saved to audit' });
    $('#adminNote').value = '';
    if (currentId===id) loadAudit(id);
  }catch(err){
    iziToast.error({ title:'Note', message: err.message || 'Server error' });
  }finally{
    done();
  }
});
// Password eye toggles
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pw-eye');
  if (!btn) return;
  const id = btn.getAttribute('data-eye');
  const input = document.getElementById(id);
  if (!input) return;
  const to = input.type === 'password' ? 'text' : 'password';
  input.type = to;
  const icon = btn.querySelector('i');
  if (icon) {
    icon.classList.toggle('fa-eye');        // show
    icon.classList.toggle('fa-eye-slash');  // hide
  }
  btn.setAttribute('aria-label', to === 'text' ? 'Hide password' : 'Show password');
});
async function apiFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) {
    // expired/invalid → clean up and bounce to login
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    iziToast.info({ title:'Session ended', message:'Please sign in again.' });
    location.href = '/';
    return r;
  }
  return r;
}
(function(){
  const _fetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await _fetch(...args);
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      document.getElementById('app')?.setAttribute('hidden', 'true');
      document.getElementById('authGate')?.removeAttribute('hidden');
      iziToast.info({ title:'Session expired', message:'Please sign in again.' });
    }
    return res;
  };
})();
