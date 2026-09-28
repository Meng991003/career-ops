// server/run-tests.mjs
import { runScript } from './lib/run.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };

const { code } = await runScript('server/fixtures/sleep.mjs', [], { timeout: 200 });
ok(code !== 0, `timed-out script reports non-zero code (got ${code})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
