// server/routes-tests.mjs
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const ok = (c, m) => c ? pass(m) : fail(m);

// Boot the real server in a child process against the real repo, hit it over HTTP.
const PORT = 3799;
const srv = spawn(process.execPath, [join(ROOT, 'server/index.mjs')],
  { env: { ...process.env, CAREER_OPS_WEB_PORT: String(PORT) }, stdio: 'ignore' });

const base = `http://127.0.0.1:${PORT}`;
async function waitForServer(maxMs = 10000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/setup/status`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start in time');
}
await waitForServer();
// This test writes real user-layer files (cv.md, profile.yml, portals.yml).
// Snapshot their original bytes so the finally block restores them exactly
// (or deletes them if they didn't exist) — never clobbering a developer's data.
const profilePath = join(ROOT, 'config/profile.yml');
const portalsPath = join(ROOT, 'portals.yml');
const cvPath = join(ROOT, 'cv.md');
const snapshot = p => (existsSync(p) ? readFileSync(p) : null);
const restore = (p, snap) => { if (snap === null) { if (existsSync(p)) unlinkSync(p); } else writeFileSync(p, snap); };
const origProfile = snapshot(profilePath);
const origPortals = snapshot(portalsPath);
const origCv = snapshot(cvPath);
try {
  const status = await (await fetch(`${base}/api/setup/status`)).json();
  ok(typeof status.onboardingNeeded === 'boolean', 'GET /api/setup/status returns onboardingNeeded');

  const apps = await (await fetch(`${base}/api/applications`)).json();
  ok(Array.isArray(apps.rows), 'GET /api/applications returns rows[]');
  ok(typeof apps.groups === 'object', 'GET /api/applications returns groups{}');

  const idx = await (await fetch(`${base}/`)).text();
  ok(idx.includes('<') , 'GET / serves web/index.html');

  const bad = await fetch(`${base}/api/nope`);
  ok(bad.status === 404, 'unknown route → 404');

  // Resume upload: post the docx fixture as raw bytes, expect extracted fields back.
  const docxBytes = readFileSync(join(ROOT, 'server/fixtures/sample.docx'));
  const up = await fetch(`${base}/api/setup/cv/upload?filename=resume.docx`, { method: 'POST', body: docxBytes });
  const upBody = await up.json();
  ok(up.status === 200, 'POST /api/setup/cv/upload returns 200');
  ok(upBody.fields && upBody.fields.email === 'jane@example.com', 'upload returns extracted email');
  ok(typeof upBody.cvText === 'string' && upBody.cvText.includes('Jane Tester'), 'upload returns cvText');

  const badUpload = await fetch(`${base}/api/setup/cv/upload?filename=notes.txt`, { method: 'POST', body: 'x' });
  ok(badUpload.status === 400, 'unsupported upload → 400');

  // Onboarding extras: salary period + preferred location, and the preferred
  // location mirrored into portals.yml's location_filter.allow.
  const jsonPost = (path, body) => fetch(`${base}${path}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await jsonPost('/api/setup/portals', { positiveKeywords: ['Engineer'] });
  const prof = await jsonPost('/api/setup/profile',
    { full_name: 'T', salary_target: 'RM8k-12k', salary_period: 'monthly', preferred_location: 'Penang / Remote' });
  ok(prof.status === 200, 'POST /api/setup/profile (with extras) returns 200');

  const savedProfile = yaml.load(readFileSync(profilePath, 'utf-8'));
  ok(savedProfile.compensation.period === 'monthly', 'profile persists compensation.period');
  ok(savedProfile.location.preferred === 'Penang / Remote', 'profile persists location.preferred');

  const savedPortals = yaml.load(readFileSync(portalsPath, 'utf-8'));
  ok(JSON.stringify(savedPortals.location_filter?.allow) === JSON.stringify(['Penang', 'Remote']),
    'preferred location mirrored into portals.yml location_filter.allow');
} finally {
  srv.kill();
  restore(cvPath, origCv);
  restore(profilePath, origProfile);
  restore(portalsPath, origPortals);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
