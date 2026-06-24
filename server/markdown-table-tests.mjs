// server/markdown-table-tests.mjs
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const eq = (a, b, m) => JSON.stringify(a) === JSON.stringify(b) ? pass(m) : fail(`${m} :: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const { parseTable, serializeRows, findRowByNum, spliceTable } =
  await import(join(HERE, 'lib/markdown-table.mjs'));

const SAMPLE = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-acme-2026-06-01.md) | strong fit |
| 2 | 2026-06-02 | Globex | Data Engineer | 3.1/5 | SKIP | ❌ | [2](reports/002-globex-2026-06-02.md) | low comp |
`;

const { headers, rows } = parseTable(SAMPLE);
eq(headers, ['#','Date','Company','Role','Score','Status','PDF','Report','Notes'], 'parses headers by name');
eq(rows.length, 2, 'parses two data rows');
eq(rows[0]['Company'], 'Acme', 'row keyed by header name');
eq(rows[1]['Status'], 'SKIP', 'status column not shifted');

const round = serializeRows(headers, rows);
eq(parseTable(round).rows, rows, 'round-trip parse(serialize(rows)) === rows');

eq(findRowByNum(rows, 2)['Company'], 'Globex', 'findRowByNum matches the # column');

// missing keys serialize as empty cells, not "undefined"
const out = serializeRows(['#','Status'], [{ '#': '9' }]);
eq(out.includes('undefined'), false, 'missing cell renders empty, not undefined');

// spliceTable: structure-preserving round-trip
const ok = (c, m) => c ? pass(m) : fail(m);
const withSurround = `# Applications Tracker\n\nIntro note.\n\n` +
  `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n` +
  `|---|------|---------|------|-------|--------|-----|--------|-------|\n` +
  `| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-acme-2026-06-01.md) | strong fit |\n` +
  `\nFooter below the table.\n`;
const sp = parseTable(withSurround);
const updated = sp.rows.map(r => ({ ...r, Status: 'Interview' }));
const out2 = spliceTable(withSurround, sp.headers, updated);
eq(out2.includes('Intro note.'), true, 'spliceTable preserves preamble');
eq(out2.includes('Footer below the table.'), true, 'spliceTable preserves content after table');
eq(parseTable(out2).rows[0]['Status'], 'Interview', 'spliceTable applies the row update');
ok(out2.indexOf('Footer below the table.') > out2.indexOf('| 1 |'), 'footer stays below the table');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
