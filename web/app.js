const $ = s => document.querySelector(s);
function showError(msg) {
  const b = $('#error-banner');
  b.textContent = msg;
  b.hidden = false;
}
let okTimer;
function showOk(msg) {
  $('#error-banner').hidden = true;
  const b = $('#ok-banner');
  b.textContent = msg;
  b.hidden = false;
  clearTimeout(okTimer);
  okTimer = setTimeout(() => { b.hidden = true; }, 3000);
}
const api = (url, opts) => fetch(url, opts).then(r => {
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}).catch(e => { showError(e.message); throw e; });
const STATES = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];

function show(view) {
  for (const id of ['onboard','board','progress']) $('#'+id).hidden = id !== view;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'board') loadBoard();
  if (view === 'progress') loadProgress();
  if (view === 'onboard') { loadData(); loadStatus(); }
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => show(b.dataset.view));

async function loadStatus() {
  const s = await api('/api/setup/status');
  $('#setup-status').textContent = s.onboardingNeeded
    ? `Setup needed — missing: ${s.missing.join(', ')}`
    : 'All set ✓';
}
// Pre-fill the Setup form with whatever's already saved.
async function loadData() {
  let d;
  try { d = await api('/api/setup/data'); } catch { return; }
  for (const [k, v] of Object.entries(d)) {
    const el = $('#' + k);
    if (el) el.value = v;
  }
}
$('#save-cv').onclick = async () => {
  try {
    await api('/api/setup/cv', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ markdown: $('#cv').value }) });
    showOk('CV saved ✓');
    loadStatus();
  } catch { /* api() already surfaced the error in the banner */ }
};
$('#cv-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#upload-status').textContent = 'Extracting…';
  try {
    const r = await fetch('/api/setup/cv/upload?filename=' + encodeURIComponent(file.name),
      { method: 'POST', body: file });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    const { cvText, fields } = await r.json();
    $('#cv').value = cvText;
    const setIf = (id, v) => { if (v) $('#' + id).value = v; };
    setIf('full_name', fields.name); setIf('email', fields.email); setIf('phone', fields.phone);
    setIf('linkedin', fields.linkedin); setIf('github', fields.github);
    $('#upload-status').textContent = 'Extracted ✓ — review the fields below, then Save CV / Save Profile.';
    loadStatus();
  } catch (err) {
    showError('Upload failed: ' + err.message);
    $('#upload-status').textContent = '';
  }
};
$('#save-profile').onclick = async () => {
  try {
    await api('/api/setup/profile', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({
        full_name: $('#full_name').value, email: $('#email').value, location: $('#location').value,
        preferred_location: $('#preferred_location').value,
        phone: $('#phone').value, linkedin: $('#linkedin').value, github: $('#github').value,
        timezone: $('#timezone').value, salary_target: $('#salary_target').value,
        salary_period: $('#salary_period').value,
        headline: $('#headline').value, exit_story: $('#exit_story').value,
        superpowers: $('#superpowers').value, proof_points: $('#proof_points').value,
        target_roles: $('#target_roles').value.split(',').map(s=>s.trim()).filter(Boolean) }) });
    showOk('Profile saved ✓');
    loadStatus();
  } catch { /* api() already surfaced the error in the banner */ }
};
$('#save-portals').onclick = async () => {
  try {
    await api('/api/setup/portals', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ positiveKeywords: $('#keywords').value.split(',').map(s=>s.trim()).filter(Boolean) }) });
    showOk('Portals saved ✓');
    loadStatus();
  } catch { /* api() already surfaced the error in the banner */ }
};

async function loadBoard() {
  const { groups } = await api('/api/applications');
  $('#board-cols').innerHTML = '';
  for (const st of STATES) {
    const rows = groups[st] || [];
    const col = document.createElement('div'); col.className = 'col';
    col.innerHTML = `<h3>${st} (${rows.length})</h3>`;
    for (const r of rows) {
      const card = document.createElement('div'); card.className = 'card';
      card.textContent = `${r['Company']} — ${r['Role']} (${r['Score']||''})`;
      card.onclick = () => openReport(r['#']);
      col.appendChild(card);
    }
    $('#board-cols').appendChild(col);
  }
}

async function openReport(num) {
  const { row, report } = await api('/api/applications/' + encodeURIComponent(num));
  $('#modal-body').textContent = report || `${row['Company']} — ${row['Role']}\n(no report file)`;
  $('#modal').hidden = false;
}
$('#modal-close').onclick = () => $('#modal').hidden = true;

async function loadProgress() {
  const { groups } = await api('/api/applications');
  const max = Math.max(1, ...STATES.map(s => (groups[s]||[]).length));
  $('#funnel').innerHTML = STATES.map(s => {
    const n = (groups[s]||[]).length;
    return `<div>${s}: ${n}<div class="bar" style="width:${(n/max)*100}%"></div></div>`;
  }).join('');
}

show('board');
