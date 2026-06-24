import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const eq = (a, b, m) => JSON.stringify(a) === JSON.stringify(b) ? pass(m) : fail(`${m} :: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const { parseList, formatList, parseProofPoints, formatProofPoints } =
  await import(join(HERE, 'lib/narrative.mjs'));

// list (superpowers): one per line
eq(parseList('A\n  B \n\nC'), ['A', 'B', 'C'], 'parseList: trims, drops blank lines');
eq(formatList(['A', 'B']), 'A\nB', 'formatList: joins with newlines');
eq(parseList(''), [], 'parseList: empty → []');
eq(formatList(null), '', 'formatList: non-array → ""');

// proof points: "name | metric | url" per line
eq(parseProofPoints('Perf work | up to 30% gains | https://x'),
   [{ name: 'Perf work', hero_metric: 'up to 30% gains', url: 'https://x' }], 'parseProofPoints: full line');
eq(parseProofPoints('Just a name'),
   [{ name: 'Just a name', hero_metric: '', url: '' }], 'parseProofPoints: name only');
eq(parseProofPoints('  | metric only'), [], 'parseProofPoints: drops lines with empty name');
eq(parseProofPoints(''), [], 'parseProofPoints: empty → []');

// round-trip + trailing-empty trimming on format
eq(formatProofPoints([{ name: 'A', hero_metric: 'm', url: '' }]), 'A | m', 'formatProofPoints: drops trailing empty url');
eq(formatProofPoints([{ name: 'A', hero_metric: '', url: '' }]), 'A', 'formatProofPoints: name only');
eq(parseProofPoints(formatProofPoints([{ name: 'A', hero_metric: 'm', url: 'u' }])),
   [{ name: 'A', hero_metric: 'm', url: 'u' }], 'proof points round-trip');
eq(formatProofPoints(null), '', 'formatProofPoints: non-array → ""');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
