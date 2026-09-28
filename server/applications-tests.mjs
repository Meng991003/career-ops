// server/applications-tests.mjs
// Boots the real server against a TEMP tracker (CAREER_OPS_TRACKER) so the
// user's data/applications.md is never touched. set-status.mjs inherits the
// env and writes status-log.tsv next to the temp tracker.
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { mkdtempSync, copyFileSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };

const dir = mkdtempSync(join(tmpdir(), 'co-apps-'));
const tracker = join(dir, 'applications.md');
copyFileSync(join(HERE, 'fixtures/applications.md'), tracker);

const PORT = 3798;
const base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(ROOT, 'server/index.mjs')],
  { env: { ...process.env, CAREER_OPS_WEB_PORT: String(PORT), CAREER_OPS_TRACKER: tracker }, stdio: 'ignore' });

async function waitForServer(maxMs = 10000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/applications`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start in time');
}
const patch = (num, body) => fetch(`${base}/api/applications/${num}`,
  { method: 'PATCH', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });

try {
  await waitForServer();
  const list = await (await fetch(`${base}/api/applications`)).json();
  ok(list.rows.length === 3, 'GET /api/applications reads the CAREER_OPS_TRACKER file');

  const r1 = await patch(2, { status: 'Applied' });
  const b1 = await r1.json();
  ok(r1.status === 200 && b1.newStatus === 'Applied', 'PATCH status → 200 with set-status JSON');
  ok(readFileSync(tracker, 'utf-8').includes('| Globex | Full Stack Developer | 3.6/5 | Applied |'), 'tracker row updated');
  const logPath = join(dir, 'status-log.tsv');
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
  ok(/^2\t\d{4}-\d{2}-\d{2}\tEvaluated\tApplied\tweb\t/m.test(log), 'status-log.tsv gets a web-sourced transition');

  const r2 = await patch(1, { note: 'recruiter pinged' });
  ok(r2.status === 200, 'PATCH note-only → 200');
  ok(readFileSync(tracker, 'utf-8').includes('strong fit; recruiter pinged'), 'note appended, not replaced');
  const log2 = readFileSync(logPath, 'utf-8');
  ok(!/^1\t/m.test(log2), 'note-only change logs no transition');

  ok((await patch(1, { status: 'Bogus' })).status === 400, 'non-canonical status → 400');
  ok((await patch(999, { status: 'Applied' })).status === 404, 'unknown row → 404');
  ok((await patch(1, {})).status === 400, 'empty body → 400');
  ok((await patch('abc', { status: 'Applied' })).status === 400, 'non-numeric row → 400');
  ok((await patch(3, { status: 'Hired' })).status === 200, 'Hired is accepted (old CANON list omitted it)');

  const list2 = await (await fetch(`${base}/api/applications`)).json();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(list2.appliedOn?.['2'] ?? ''), 'list returns appliedOn from status-log');
  const d = await (await fetch(`${base}/api/applications/2`)).json();
  ok(d.timeline.some(t => t.kind === 'status' && t.detail === 'Evaluated → Applied'), 'detail timeline has the transition');
  ok(d.documents && 'cv' in d.documents && 'cover' in d.documents, 'detail has documents{cv,cover}');
  ok(Array.isArray(d.contacts), 'detail has contacts[]');
  const trav = await fetch(`${base}/api/files/output/..%2F..%2Fcv.md`);
  ok(trav.status === 404, 'files route blocks path traversal');

  const fixtureDir = join(ROOT, 'output/zz-test-fixture');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, 'x.html'), '<script>alert(1)</script>');
  writeFileSync(join(fixtureDir, 'x.pdf'), '%PDF-1.4 fake');
  try {
    const htmlRes = await fetch(`${base}/api/files/output/zz-test-fixture/x.html`);
    ok(htmlRes.status === 404, 'files route 404s non-allowlisted extensions (.html)');

    const pdfRes = await fetch(`${base}/api/files/output/zz-test-fixture/x.pdf`);
    ok(pdfRes.status === 200, 'files route 200s an allowlisted .pdf');
    ok(pdfRes.headers.get('content-type') === 'application/pdf', 'pdf served with content-type: application/pdf');
    ok((pdfRes.headers.get('content-security-policy') || '').includes('sandbox'), 'pdf response carries a sandboxing CSP');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
} finally {
  srv.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
