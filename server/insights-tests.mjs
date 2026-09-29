// server/insights-tests.mjs
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };

async function boot(port, tracker) {
  const srv = spawn(process.execPath, [join(HERE, 'index.mjs')],
    { env: { ...process.env, CAREER_OPS_WEB_PORT: String(port), CAREER_OPS_TRACKER: tracker }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${base}/api/applications`)).ok) return { srv, base }; } catch {} await new Promise(r => setTimeout(r, 50)); }
  srv.kill();
  throw new Error('server did not start');
}

const dir = mkdtempSync(join(tmpdir(), 'co-insights-'));
const tracker = join(dir, 'applications.md');
copyFileSync(join(HERE, 'fixtures/applications.md'), tracker);

const PORT = 3797;
let ctx;
try {
  ctx = await boot(PORT, tracker);
  const { base, srv } = ctx;
  try {
    const t = await fetch(`${base}/api/today`);
    const tb = await t.json();
    ok(t.status === 200, 'GET /api/today → 200');
    ok(typeof tb.followUps?.total === 'number' && Array.isArray(tb.followUps.items), 'today.followUps {total, items}');
    ok(Array.isArray(tb.worthApplying?.items), 'today.worthApplying.items');
    ok(tb.digest === null || Array.isArray(tb.digest.items), 'today.digest is null or {items}');
    ok(Array.isArray(tb.quietInterviews), 'today.quietInterviews[]');
    ok(typeof tb.funnel?.everApplied === 'number', 'today.funnel from stats.mjs');
    ok(typeof tb.calibration?.responseRate === 'object', 'today.calibration from funnel-velocity.mjs');
    ok(Array.isArray(tb.warnings), 'today.warnings[]');
    const s = await fetch(`${base}/api/stats`);
    const sb = await s.json();
    ok(s.status === 200 && Array.isArray(sb.stats?.scan?.addedPerWeek) && typeof sb.velocity?.velocity === 'object', 'GET /api/stats → {stats, velocity}');
    ok(Array.isArray(sb.warnings), 'stats.warnings[]');
    ok((await fetch(`${base}/api/today`, { method: 'POST', headers: { origin: base } })).status === 404, 'today is GET-only');
  } finally { srv.kill(); }

  // Header-only tracker: followup-cadence.mjs (and friends) exit 1 with no
  // rows to report on, so both endpoints must degrade instead of 500ing.
  const headerOnly = readFileSync(join(HERE, 'fixtures/applications.md'), 'utf-8').split('\n').slice(0, 4).join('\n') + '\n';
  const emptyTracker = join(dir, 'empty.md');
  writeFileSync(emptyTracker, headerOnly);
  const empty = await boot(PORT + 1, emptyTracker);
  try {
    const t = await fetch(`${empty.base}/api/today`);
    const tb = await t.json();
    ok(t.status === 200, 'empty tracker: GET /api/today → 200, not 500');
    ok(tb.followUps.total === 0, 'empty tracker: followUps.total === 0');
    ok(Array.isArray(tb.warnings), 'empty tracker: warnings is an array');

    const s = await fetch(`${empty.base}/api/stats`);
    ok(s.status === 200, 'empty tracker: GET /api/stats → 200, not 500');
  } finally { empty.srv.kill(); }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
