// server/routes-tests.mjs
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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
} finally {
  srv.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
