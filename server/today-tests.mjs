// server/today-tests.mjs
import { followUpsDue, worthApplying, latestDigestName, topDigestJobs } from './lib/today.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m);

const cadence = { entries: [
  { num: 1, company: 'A', role: 'r', score: '3.7/5', urgency: 'overdue', daysSinceApplication: 38, daysUntilNext: -31, contacts: [] },
  { num: 2, company: 'B', role: 'r', score: '4.2/5', urgency: 'overdue', daysSinceApplication: 20, daysUntilNext: -5, contacts: [{}] },
  { num: 3, company: 'C', role: 'r', score: '3.7/5', urgency: 'urgent', daysSinceApplication: 9, daysUntilNext: -40, contacts: [] },
  { num: 4, company: 'D', role: 'r', score: '4.9/5', urgency: 'waiting', daysSinceApplication: 2, daysUntilNext: 5, contacts: [] },
] };
const fu = followUpsDue(cadence, 2);
eq(fu.total, 3, 'followUpsDue counts overdue + urgent, not waiting');
eq(fu.items.map(i => i.num), ['2', '3'], 'highest score first, then most overdue');
eq(fu.items[0].hasContact, true, 'hasContact reflects the contacts array');
eq(fu.items[1].daysOverdue, 40, 'daysOverdue is the positive days past due');
eq(followUpsDue(null).total, 0, 'missing cadence → empty');

const rows = [
  { '#': '10', Company: 'X', Role: 'r', Score: '4.5/5', Status: 'Evaluated' },
  { '#': '11', Company: 'Y', Role: 'r', Score: '4.0/5', Status: 'Evaluated' },
  { '#': '12', Company: 'Z', Role: 'r', Score: '4.8/5', Status: 'Applied' },
  { '#': '13', Company: 'W', Role: 'r', Score: '3.9/5', Status: 'Evaluated' },
];
const wa = worthApplying(rows);
eq(wa.items.map(i => i.num), ['10', '11'], 'worthApplying: Evaluated and ≥ 4.0 only, best first');
eq(wa.items[0].score, 4.5, 'score is a number');

eq(latestDigestName(['digest-2026-09-25.json', 'digest-2026-09-28.html', 'digest-2026-09-27.json', 'x.json']),
  'digest-2026-09-27.json', 'latestDigestName picks the newest .json, ignores html');
eq(latestDigestName([]), null, 'no digest → null');

const digest = { date: '2026-09-28', sections: [
  { label: 'JobStreet', jobs: [{ title: 'a', triage: 5, applyRoute: 'open' }, { title: 'b', triage: 9, applyRoute: 'gated' }] },
  { label: 'foundit', jobs: [{ title: 'c', triage: 7, applyRoute: 'likely-gated' }] },
] };
const td = topDigestJobs(digest, 5);
eq(td.items.map(j => j.title), ['c', 'a'], 'topDigestJobs: gated excluded, best triage first');
eq(td.items[0].source, 'foundit', 'each job carries its section label as source');
eq([td.total, td.date], [2, '2026-09-28'], 'total counts the non-gated jobs; date carried');
eq(topDigestJobs(null), null, 'no digest → null');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
