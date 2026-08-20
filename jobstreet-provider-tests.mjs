#!/usr/bin/env node
// @ts-check
/**
 * jobstreet-provider-tests.mjs — unit tests for the JobStreet/SEEK v5 provider.
 * Run: node jobstreet-provider-tests.mjs
 *
 * Fixtures are verbatim real API responses captured 2026-08-20 from
 * sg.jobstreet.com/api/jobsearch/v5/search. The v5 shape has NO jobUrl field —
 * the job URL must be built from `id`.
 */

import { parseJobstreetItem } from './providers/jobstreet.mjs';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName}`); }
}
function section(name) { console.log(`\n━━━ ${name} ━━━`); }

const BASE = 'https://sg.jobstreet.com';

// Verbatim real v5 item (2026-08-20).
const REAL_ITEM = {
  id: '94049727',
  title: 'Software Engineer',
  advertiser: { id: '62503619', description: 'Alpha X Technology Pte. Ltd.' },
  branding: { serpLogoUrl: 'https://bx-branding-gateway.cloud.seek.com.au/x.1/jdpLogo' },
  companyName: 'Alpha X Technology Pte. Ltd.',
  locations: [{ label: 'Central Region', countryCode: 'SG' }],
  listingDate: '2026-08-18T07:21:37Z',
  salaryLabel: '$4,000 – $6,000 per month',
  workTypes: ['Full time'],
};

section('parseJobstreetItem — real v5 shape');

const job = parseJobstreetItem(REAL_ITEM, BASE, '');
assert(job !== null, 'real v5 item parses (not null)');
assert(job?.title === 'Software Engineer', 'title extracted');
assert(job?.url === 'https://sg.jobstreet.com/job/94049727', 'url built from id (v5 has no jobUrl)');
assert(job?.company === 'Alpha X Technology Pte. Ltd.', 'company from advertiser.description');
assert(job?.location === 'Central Region', 'location from locations[0].label');
assert(job?.postedAt === Date.parse('2026-08-18T07:21:37Z'), 'postedAt from listingDate');

section('parseJobstreetItem — field fallbacks');

assert(
  parseJobstreetItem({ ...REAL_ITEM, advertiser: undefined }, BASE, '')?.company
    === 'Alpha X Technology Pte. Ltd.',
  'falls back to companyName when advertiser missing'
);
assert(
  parseJobstreetItem({ ...REAL_ITEM, advertiser: undefined, companyName: undefined }, BASE, 'Fallback Co')?.company
    === 'Fallback Co',
  'falls back to entry name when both company fields missing'
);
assert(
  parseJobstreetItem({ ...REAL_ITEM, locations: [] }, BASE, '')?.location === '',
  'empty locations array → empty location, still parses'
);
assert(
  parseJobstreetItem({ ...REAL_ITEM, listingDate: 'not-a-date' }, BASE, '')?.postedAt === undefined,
  'unparseable listingDate → postedAt omitted (NaN-safe)'
);

section('parseJobstreetItem — rejections');

assert(parseJobstreetItem(null, BASE, '') === null, 'null item → null');
assert(parseJobstreetItem({ id: '1' }, BASE, '') === null, 'missing title → null');
assert(parseJobstreetItem({ ...REAL_ITEM, id: undefined }, BASE, '') === null, 'missing id → null (cannot build url)');
assert(
  parseJobstreetItem(REAL_ITEM, 'https://evil.example.com', '') === null,
  'untrusted base host → null'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
