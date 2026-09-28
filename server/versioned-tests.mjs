import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileVersion, isStale } from './lib/versioned.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const dir = mkdtempSync(join(tmpdir(), 'co-ver-'));
const f = join(dir, 'a.md');
try {
  ok(await fileVersion(f) === null, 'missing file → null');
  writeFileSync(f, 'one');
  const v1 = await fileVersion(f);
  ok(/^[0-9a-f]{40}$/.test(v1), 'version is sha1 hex');
  ok(!(await isStale(f, v1)), 'unchanged file is not stale');
  ok(!(await isStale(f, undefined)), 'no expected version → not stale (legacy client)');
  writeFileSync(f, 'two');
  ok(await isStale(f, v1), 'changed file is stale');
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
