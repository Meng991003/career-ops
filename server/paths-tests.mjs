// server/paths-tests.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const ok = (cond, m) => cond ? pass(m) : fail(m);

const { resolveUserPath, REPO_ROOT } = await import(join(HERE, 'lib/paths.mjs'));

ok(resolveUserPath('cv.md').startsWith(REPO_ROOT), 'cv.md resolves under repo root');
ok(resolveUserPath('config/profile.yml').endsWith('config/profile.yml'), 'profile.yml allowed');
ok(resolveUserPath('data/applications.md').includes('data/'), 'data/* allowed');

let threw = false;
try { resolveUserPath('modes/_shared.md'); } catch { threw = true; }
ok(threw, 'system-layer modes/_shared.md is blocked');

threw = false;
try { resolveUserPath('../outside.txt'); } catch { threw = true; }
ok(threw, 'path traversal is blocked');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
