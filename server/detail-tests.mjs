// server/detail-tests.mjs
import { parseStatusLog, appliedOnByRow, parseFollowUps, reportNumOf, outputDirFor } from './lib/detail.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m);

const log = parseStatusLog('76\t2026-08-31\tEvaluated\tApplied\tset-status\t\n109\t2026-09-02\tEvaluated\tApplied\tweb\t\n109\t2026-09-03\tApplied\tEvaluated\tset-status\toops\n\nbad line\n');
eq(log.length, 3, 'status-log: three well-formed lines, junk skipped');
eq(log[2], { num: '109', date: '2026-09-03', from: 'Applied', to: 'Evaluated', source: 'set-status', note: 'oops' }, 'status-log: fields');
eq(appliedOnByRow(log), { '76': '2026-08-31', '109': '2026-09-02' }, 'appliedOn: last transition INTO Applied per row');

const fu = `# Follow-ups

| num | appNum | date | company | role | channel | contact | notes |
|---|---|---|---|---|---|---|---|
| 1 | 76 | 2026-09-08 | Acme | Dev | email | Jo | nudged |
- next #76 2026-09-15 (set 2026-09-08)
- next #77 2026-09-16 (set 2026-09-08)
`;
eq(parseFollowUps(fu, '76'), [
  { date: '2026-09-08', kind: 'sent', detail: 'email to Jo — nudged' },
  { date: '2026-09-15', kind: 'due', detail: 'follow-up due' },
], 'follow-ups: sent row + due bullet for this row only');

eq(reportNumOf({ Report: '[025](../reports/025-ufinity-2026-08-30.md)' }), 25, 'report number from link');
eq(reportNumOf({ Report: '—' }), null, 'no report link → null');
eq(outputDirFor(25, ['001-persol', '025-ufinity', '250-other']), '025-ufinity', 'output dir by padded prefix');
eq(outputDirFor(7, ['070-x', '007-y']), '007-y', 'prefix match is exact-number, not startsWith');
eq(outputDirFor(9, ['001-a']), null, 'no dir → null');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
