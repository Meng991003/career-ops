import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const eq = (a, b, m) => JSON.stringify(a) === JSON.stringify(b) ? pass(m) : fail(`${m} :: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const { parsePreferredLocations } = await import(join(HERE, 'lib/locations.mjs'));

eq(parsePreferredLocations('Kuala Lumpur / Remote'), ['Kuala Lumpur', 'Remote'], 'splits on slash');
eq(parsePreferredLocations('Penang, Singapore'), ['Penang', 'Singapore'], 'splits on comma');
eq(parsePreferredLocations('  KL  /  , Remote ,'), ['KL', 'Remote'], 'trims and drops empties');
eq(parsePreferredLocations('Remote / remote / Remote'), ['Remote', 'remote'], 'dedupes exact (case-sensitive) duplicates');
eq(parsePreferredLocations('Cyberjaya'), ['Cyberjaya'], 'single location');
eq(parsePreferredLocations(''), [], 'empty string → []');
eq(parsePreferredLocations(null), [], 'null → []');
eq(parsePreferredLocations(undefined), [], 'undefined → []');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
