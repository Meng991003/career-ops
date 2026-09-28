// server/insights-tests.mjs
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const PORT = 3797, base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'index.mjs')], { env: { ...process.env, CAREER_OPS_WEB_PORT: String(PORT) }, stdio: 'ignore' });
async function up() { for (let i = 0; i < 200; i++) { try { if ((await fetch(`${base}/api/applications`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 50)); } throw new Error('server did not start'); }
try {
  await up();
  const t = await fetch(`${base}/api/today`);
  const tb = await t.json();
  ok(t.status === 200, 'GET /api/today → 200');
  ok(typeof tb.followUps?.total === 'number' && Array.isArray(tb.followUps.items), 'today.followUps {total, items}');
  ok(Array.isArray(tb.worthApplying?.items), 'today.worthApplying.items');
  ok(tb.digest === null || Array.isArray(tb.digest.items), 'today.digest is null or {items}');
  ok(Array.isArray(tb.quietInterviews), 'today.quietInterviews[]');
  ok(typeof tb.funnel?.everApplied === 'number', 'today.funnel from stats.mjs');
  ok(typeof tb.calibration?.responseRate === 'object', 'today.calibration from funnel-velocity.mjs');
  const s = await fetch(`${base}/api/stats`);
  const sb = await s.json();
  ok(s.status === 200 && Array.isArray(sb.stats?.scan?.addedPerWeek) && typeof sb.velocity?.velocity === 'object', 'GET /api/stats → {stats, velocity}');
  ok((await fetch(`${base}/api/today`, { method: 'POST', headers: { origin: base } })).status === 404, 'today is GET-only');
} finally { srv.kill(); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
