# Daily Singapore Job Routine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily routine that scans Singapore job sources, ranks roles not yet applied to, and assists tailoring and submitting applications under two human approval gates.

**Architecture:** Seven deltas on the existing career-ops pipeline. Two new HTTP providers feed the existing zero-token scanner; a new digest script renders the daily HTML; a new standalone skill encodes the interactive playbook. Everything else — dedup, CV/cover-letter generation, liveness, tracker — is reused unchanged.

**Tech Stack:** Node.js 18+ (ESM `.mjs`), `js-yaml`, `playwright` (already installed). No new dependencies. Tests are plain assertion scripts, no framework.

**Spec:** `docs/superpowers/specs/2026-08-20-daily-singapore-job-routine-design.md`

## Global Constraints

- **Node ESM only.** All files are `.mjs` with `import`/`export`. No CommonJS, no TypeScript.
- **No new dependencies.** Use only `js-yaml`, `playwright`, and Node built-ins.
- **Zero-token scanning.** Providers make direct HTTP calls. Never invoke an LLM from a provider or from `daily-digest.mjs`.
- **Use career-ops' own User-Agent.** `providers/_http.mjs` sends `Mozilla/5.0 (compatible; career-ops/1.3)`. Both JobStreet and LinkedIn were verified working with it on 2026-08-20. **Do not spoof a browser User-Agent.**
- **Salary values are ANNUAL.** `scan.mjs`'s `buildSalaryFilter` compares annualized numbers. A monthly salary must be multiplied by 12 before it is emitted. The candidate's SGD6000/month floor is `72000` annual.
- **Singapore only.** `siteKey: SG-Main`, `where=Singapore`, `location=Singapore`. No Malaysia scanning.
- **Test convention.** Root-level `<name>-tests.mjs`, run with `node <name>-tests.mjs`. Use the existing `assert(cond, name)` / `section(name)` / `passed`/`failed` counter pattern from `test-salary-filter.mjs`, ending with `process.exit(failed > 0 ? 1 : 0)`. No test framework.
- **Conservative filtering.** A job with unparseable or absent salary must PASS the filter, never be dropped. Wrongly hiding a viable role is worse than showing an unpriced one.
- **Never fabricate résumé facts.** The resume carries exactly one hard metric (up to 30% performance gains). Do not invent others.
- **Two approval gates.** No application is ever submitted without the candidate's explicit per-application approval. No CAPTCHA solving. No credential entry.
- **Branch:** `feat/daily-job-routine`. Commit after every task.

## File Structure

| Path | Responsibility | New? |
|------|---------------|------|
| `providers/jobstreet.mjs` | JobStreet/SEEK v5 search + salary-label parsing | modify (exists upstream — **will be overwritten by `npm run update`**; upstream as a PR) |
| `jobstreet-provider-tests.mjs` | Unit tests for the two exported parsers | create |
| `providers/linkedin-guest.mjs` | LinkedIn unauthenticated guest-endpoint HTML parsing | create |
| `linkedin-guest-tests.mjs` | Unit tests for the card parser | create |
| `portals.yml` | Singapore-only scan config (gitignored, user layer) | create |
| `answers.mjs` | Load/match/append the Q&A knowledge base | create |
| `answers-tests.mjs` | Unit tests for load/match/append | create |
| `data/answers.yml` | The Q&A store itself (gitignored — personal data) | create |
| `daily-digest.mjs` | Fetch, rank, render `output/digest-YYYY-MM-DD.html` | create |
| `daily-digest-tests.mjs` | Unit tests for ranking, capping, rendering | create |
| `.claude/skills/daily-jobs/SKILL.md` | Interactive playbook + approval gates | create |

Only `providers/jobstreet.mjs` and `.gitignore` are edits to existing upstream files. Everything else is a new file, which survives updates.

---

### Task 1: Fix the JobStreet provider's endpoint and item parsing

The current provider targets `api/chalice-search/v4/search`, which returns HTTP 404. The working endpoint is `api/jobsearch/v5/search`, whose response shape differs: there is **no `jobUrl` field**, company moved, and location became an array.

**Files:**
- Modify: `providers/jobstreet.mjs` (constants near lines 23-25; `parseJobstreetItem` ~line 96; `buildSearchUrl` ~line 133; `fetch` ~line 155)
- Create: `jobstreet-provider-tests.mjs`

**Interfaces:**
- Consumes: `Provider` typedef from `providers/_types.js`; `ctx.fetchJson` from `providers/_http.mjs`.
- Produces: `parseJobstreetItem(item, baseUrl, fallbackCompany)` → `{title, url, company, location, postedAt?}|null`. Task 2 adds `parseSalaryLabel` to the same file.

- [ ] **Step 1: Write the failing test**

Create `jobstreet-provider-tests.mjs`. The fixture below is a verbatim real v5 item captured from `sg.jobstreet.com` on 2026-08-20.

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node jobstreet-provider-tests.mjs
```

Expected: FAIL. The current `parseJobstreetItem` reads `item.jobUrl` (absent in v5) and returns `null`, so the url/company/location assertions fail.

- [ ] **Step 3: Update the constants and `buildSearchUrl`**

In `providers/jobstreet.mjs`, replace the endpoint and site-key defaults (near lines 23-25):

```javascript
const DEFAULT_API = 'https://sg.jobstreet.com/api/jobsearch/v5/search';
const DEFAULT_SITE_KEY = 'SG-Main';
```

In `buildSearchUrl`, drop the `solrFields` line — it is a v4 parameter and v5 ignores it:

```javascript
function buildSearchUrl(apiUrl, params) {
  const url = new URL(apiUrl);
  const { siteKey, keywords, location, pageSize, page } = params;
  if (siteKey) url.searchParams.set('siteKey', siteKey);
  if (keywords) url.searchParams.set('keywords', keywords);
  if (location) url.searchParams.set('where', location);
  url.searchParams.set('pageSize', String(pageSize || DEFAULT_PAGE_SIZE));
  url.searchParams.set('page', String(page || 1));
  return url.href;
}
```

- [ ] **Step 4: Rewrite `parseJobstreetItem` for the v5 shape**

Replace the whole function body. Note it now builds the URL from `id` and validates the base host before returning.

```javascript
/**
 * Parse a single JobStreet/SEEK **v5** API result into the canonical Job shape.
 *
 * v5 differs from the retired v4 in three ways that matter here:
 *   - there is no `jobUrl` field — the detail URL is `{base}/job/{id}`
 *   - company lives in `advertiser.description` (`branding` carries only a logo)
 *   - `location` became `locations[]`, keyed on `.label`
 *
 * @param {any} item — raw v5 result item
 * @param {string} baseUrl — scheme + hostname used to build the job URL
 * @param {string} fallbackCompany — company name fallback from the portal entry
 * @returns {{title: string, url: string, company: string, location: string, postedAt?: number}|null}
 */
export function parseJobstreetItem(item, baseUrl, fallbackCompany) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  const id = String(item.id ?? '').trim();
  if (!id) return null;

  // v5 has no jobUrl — build it, then validate the host we built it on.
  let url;
  try {
    const parsed = new URL(`/job/${encodeURIComponent(id)}`, baseUrl);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname)) return null;
    url = parsed.href;
  } catch {
    return null;
  }

  const company = (
    item.advertiser?.description
    || item.companyName
    || item.branding?.name
    || fallbackCompany
    || ''
  ).trim();

  const location = (item.locations?.[0]?.label || '').trim();
  const postedAt = toEpochMs(item.listingDate);

  return { title, url, company, location, ...(postedAt != null ? { postedAt } : {}) };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node jobstreet-provider-tests.mjs
```

Expected: PASS, `14 passed, 0 failed`.

- [ ] **Step 6: Live smoke test**

```bash
node -e "import('./providers/jobstreet.mjs').then(async m=>{const {makeHttpCtx}=await import('./providers/_http.mjs');const jobs=await m.default.fetch({name:'JobStreet SG',searchKeywords:'software engineer',searchLocation:'Singapore',maxPages:1,pageSize:5},makeHttpCtx());console.log('fetched',jobs.length);console.log(jobs[0]);})"
```

Expected: 5 jobs, each with a `https://sg.jobstreet.com/job/<id>` url and a non-empty company.

- [ ] **Step 7: Commit**

```bash
git add providers/jobstreet.mjs jobstreet-provider-tests.mjs
git commit -m "fix(providers): retarget jobstreet to the v5 search endpoint

chalice-search/v4 returns HTTP 404. api/jobsearch/v5/search works without
auth, but changes the response shape: no jobUrl field (build from id),
company in advertiser.description, location in locations[0].label.

Defaults move to Singapore (sg.jobstreet.com, SG-Main)."
```

---

### Task 2: Emit structured, annualized salary from JobStreet

The provider currently requests salary but never emits it, so `scan.mjs`'s salary filter can never act on JobStreet results. Real labels observed live include non-salary strings (`"World Class Benefits"`) and shorthand (`"$4k - $4500 p.m. + Aws,Bonus"`) which must return `null` rather than risk a wrong number driving a wrong rejection.

**Files:**
- Modify: `providers/jobstreet.mjs` (add `parseSalaryLabel`; attach `salary` in `fetch`)
- Modify: `jobstreet-provider-tests.mjs` (add a section)

**Interfaces:**
- Consumes: `parseJobstreetItem` from Task 1.
- Produces: `parseSalaryLabel(label)` → `{min: number, max: number, currency: string}|null`, **annualized**. Matches the shape `scan.mjs`'s `buildSalaryFilter` consumes and the convention of `parseCompensation` in `providers/ashby.mjs`.

- [ ] **Step 1: Write the failing test**

Append to `jobstreet-provider-tests.mjs`, immediately before the final `console.log`/`process.exit` lines. Every string here is a real observed label except where noted.

```javascript
section('parseSalaryLabel — real observed labels, annualized');

assert(
  JSON.stringify(parseSalaryLabel('$4,000 – $6,000 per month'))
    === JSON.stringify({ min: 48000, max: 72000, currency: 'SGD' }),
  'monthly en-dash range → annualized x12'
);
assert(
  JSON.stringify(parseSalaryLabel('$6,000 - $7,000 per month'))
    === JSON.stringify({ min: 72000, max: 84000, currency: 'SGD' }),
  'monthly hyphen range → annualized x12'
);
assert(
  JSON.stringify(parseSalaryLabel('$5,000 per month'))
    === JSON.stringify({ min: 60000, max: 60000, currency: 'SGD' }),
  'single monthly value → min === max'
);
assert(
  JSON.stringify(parseSalaryLabel('$90,000 – $120,000 per year'))
    === JSON.stringify({ min: 90000, max: 120000, currency: 'SGD' }),
  'yearly range → not multiplied'
);
assert(
  JSON.stringify(parseSalaryLabel('$90,000 per annum'))
    === JSON.stringify({ min: 90000, max: 90000, currency: 'SGD' }),
  '"per annum" recognised as yearly'
);
assert(
  JSON.stringify(parseSalaryLabel('$7,000 – $5,000 per month'))
    === JSON.stringify({ min: 60000, max: 84000, currency: 'SGD' }),
  'reversed range is ordered min <= max'
);

section('parseSalaryLabel — must return null (job then passes filter)');

assert(parseSalaryLabel('World Class Benefits') === null, 'real non-salary label → null');
assert(parseSalaryLabel('$4k - $4500 p.m. + Aws,Bonus') === null, 'real "k" shorthand + noise → null');
assert(parseSalaryLabel('') === null, 'empty string → null');
assert(parseSalaryLabel(null) === null, 'null → null');
assert(parseSalaryLabel(undefined) === null, 'undefined → null');
assert(parseSalaryLabel('$5,000') === null, 'no period stated → null (cannot annualize safely)');
assert(parseSalaryLabel('Competitive salary per month') === null, 'period but no numbers → null');
assert(parseSalaryLabel('$200 – $400 per month') === null, 'implausibly low figures → null');
```

Add `parseSalaryLabel` to the import at the top of the file:

```javascript
import { parseJobstreetItem, parseSalaryLabel } from './providers/jobstreet.mjs';
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node jobstreet-provider-tests.mjs
```

Expected: FAIL immediately — `parseSalaryLabel` is not exported, so the import throws `SyntaxError: The requested module ... does not provide an export named 'parseSalaryLabel'`.

- [ ] **Step 3: Implement `parseSalaryLabel`**

Add to `providers/jobstreet.mjs`, after `toEpochMs`:

```javascript
// Minimum plausible monthly figure. Guards against parsing hourly rates or
// stray numbers ("$200 per month") into a salary that would wrongly reject a
// job. Anything below this yields null, so the job passes the filter instead.
const MIN_PLAUSIBLE_MONTHLY = 1000;

/**
 * Parse a JobStreet `salaryLabel` free-text string into an ANNUALIZED
 * `{min, max, currency}`, matching the convention of `parseCompensation` in
 * providers/ashby.mjs and the shape `buildSalaryFilter` in scan.mjs consumes.
 *
 * Deliberately conservative: this handles only the unambiguous canonical form
 * and returns null for everything else. `buildSalaryFilter` passes jobs with no
 * salary data, so null means "show it, unpriced" — strictly safer than guessing
 * a number that could wrongly reject a viable role. Real labels that must yield
 * null include "World Class Benefits" and "$4k - $4500 p.m. + Aws,Bonus".
 *
 * @param {string|null|undefined} label
 * @returns {{min: number, max: number, currency: string}|null}
 */
export function parseSalaryLabel(label) {
  if (typeof label !== 'string') return null;
  const text = label.trim();
  if (!text) return null;

  // Require an explicit currency marker.
  if (!/\$|\bSGD\b/i.test(text)) return null;

  // Require an explicit, unambiguous period. Abbreviations like "p.m." appear
  // only in noisy free-text labels, so they are intentionally not accepted.
  const multiplier = /per\s+month|monthly/i.test(text) ? 12
    : /per\s+year|per\s+annum|annually|yearly/i.test(text) ? 1
    : null;
  if (multiplier === null) return null;

  // Reject shorthand magnitudes ("$4k") — ambiguous enough that guessing risks
  // an order-of-magnitude error.
  if (/\d\s*k\b/i.test(text)) return null;

  // Only comma-grouped or plain integers, optionally with decimals.
  const numbers = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map(m => Number(m[0].replace(/,/g, '')))
    .filter(n => Number.isFinite(n));

  const monthlyEquivalents = numbers.filter(
    n => (multiplier === 12 ? n : n / 12) >= MIN_PLAUSIBLE_MONTHLY
  );
  if (monthlyEquivalents.length === 0) return null;

  const annualized = monthlyEquivalents.map(n => n * multiplier);
  return {
    min: Math.min(...annualized),
    max: Math.max(...annualized),
    currency: 'SGD',
  };
}
```

- [ ] **Step 4: Attach salary to each job in `fetch`**

In the `fetch` loop, where jobs are pushed, enrich with salary. Replace:

```javascript
      for (const item of data) {
        const job = parseJobstreetItem(item, baseUrl, fallbackCompany);
        if (job) allJobs.push(job);
      }
```

with:

```javascript
      for (const item of data) {
        const job = parseJobstreetItem(item, baseUrl, fallbackCompany);
        if (!job) continue;
        const salary = parseSalaryLabel(item.salaryLabel);
        allJobs.push(salary ? { ...job, salary } : job);
      }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node jobstreet-provider-tests.mjs
```

Expected: PASS, `28 passed, 0 failed`.

- [ ] **Step 6: Confirm the filter actually rejects using real data**

```bash
node -e "Promise.all([import('./providers/jobstreet.mjs'),import('./providers/_http.mjs'),import('./scan.mjs')]).then(async ([p,h,s])=>{const jobs=await p.default.fetch({name:'JobStreet SG',searchKeywords:'software engineer',searchLocation:'Singapore',maxPages:1,pageSize:100},h.makeHttpCtx());const f=s.buildSalaryFilter({min:72000,max:0,currency:'SGD'});const priced=jobs.filter(j=>j.salary);console.log('total',jobs.length,'priced',priced.length,'priced+pass',priced.filter(j=>f(j.salary)).length,'unpriced(all pass)',jobs.length-priced.length);})"
```

Expected: a non-zero `priced` count, `priced+pass` strictly less than `priced` (proving the floor rejects something), and every unpriced job passing.

- [ ] **Step 7: Commit**

```bash
git add providers/jobstreet.mjs jobstreet-provider-tests.mjs
git commit -m "feat(providers): emit annualized structured salary from jobstreet

The provider requested salary but never emitted it, so scan.mjs's salary
filter could never act on JobStreet results.

parseSalaryLabel handles only the unambiguous canonical form and returns null
otherwise. buildSalaryFilter passes jobs with no salary data, so null means
'show it, unpriced' — safer than guessing a number that wrongly rejects a
viable role. Real labels needing null: 'World Class Benefits' and
'\$4k - \$4500 p.m. + Aws,Bonus'."
```

---

### Task 3: Add the LinkedIn guest provider

LinkedIn's unauthenticated guest endpoint returns an HTML fragment of `<li>` cards, not JSON. Verified 2026-08-20 returning 10 cards per request with career-ops' own User-Agent.

**Files:**
- Create: `providers/linkedin-guest.mjs`
- Create: `linkedin-guest-tests.mjs`

**Interfaces:**
- Consumes: `Provider` typedef from `providers/_types.js`; `ctx.fetchText` from `providers/_http.mjs` (precedent: `providers/workable.mjs`).
- Produces: default export `Provider` with `id: 'linkedin-guest'`; named export `parseLinkedInCards(html)` → `Array<{title, url, company, location, postedAt?}>`.

- [ ] **Step 1: Write the failing test**

Create `linkedin-guest-tests.mjs`. The fixture is a trimmed but structurally verbatim card from the live endpoint.

```javascript
#!/usr/bin/env node
// @ts-check
/**
 * linkedin-guest-tests.mjs — unit tests for the LinkedIn guest-endpoint parser.
 * Run: node linkedin-guest-tests.mjs
 *
 * Fixture mirrors the real HTML fragment returned by
 * linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search (captured
 * 2026-08-20). The endpoint returns HTML, not JSON.
 */

import { parseLinkedInCards } from './providers/linkedin-guest.mjs';

let passed = 0;
let failed = 0;
function assert(condition, testName) {
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName}`); }
}
function section(name) { console.log(`\n━━━ ${name} ━━━`); }

const CARD = `<li>
  <div class="base-card relative">
    <a class="base-card__full-link" href="https://sg.linkedin.com/jobs/view/software-engineer-at-grab-4432?trk=guest">
      <span class="sr-only">Software Engineer</span>
    </a>
    <h3 class="base-search-card__title">
        Software Engineer
    </h3>
    <h4 class="base-search-card__subtitle">
      <a class="hidden-nested-link" href="https://sg.linkedin.com/company/grab">Grab</a>
    </h4>
    <span class="job-search-card__location">Singapore</span>
    <time class="job-search-card__listdate" datetime="2026-08-19">1 day ago</time>
  </div>
</li>`;

section('parseLinkedInCards — single real card');

const one = parseLinkedInCards(CARD);
assert(one.length === 1, 'one card parsed');
assert(one[0]?.title === 'Software Engineer', 'title trimmed of whitespace');
assert(one[0]?.company === 'Grab', 'company from hidden-nested-link');
assert(one[0]?.location === 'Singapore', 'location extracted');
assert(one[0]?.postedAt === Date.parse('2026-08-19'), 'postedAt from datetime attribute');
assert(
  one[0]?.url === 'https://sg.linkedin.com/jobs/view/software-engineer-at-grab-4432',
  'url extracted and query string stripped'
);

section('parseLinkedInCards — multiple cards');

const three = parseLinkedInCards(CARD + CARD + CARD);
assert(three.length === 3, 'three cards parsed from a concatenated fragment');

section('parseLinkedInCards — resilience');

assert(parseLinkedInCards('').length === 0, 'empty string → empty array');
assert(parseLinkedInCards('<li>no useful content</li>').length === 0, 'card with no title is skipped');
assert(
  parseLinkedInCards(CARD.replace(/<h4[\s\S]*?<\/h4>/, '')).length === 1,
  'missing company does not drop the card'
);
assert(
  parseLinkedInCards(CARD.replace(/<h4[\s\S]*?<\/h4>/, ''))[0].company === '',
  'missing company yields empty string'
);
assert(
  parseLinkedInCards(CARD.replace('https://sg.linkedin.com/jobs/view/software-engineer-at-grab-4432?trk=guest', 'https://evil.example.com/jobs/view/x')).length === 0,
  'non-linkedin href is rejected'
);
assert(
  parseLinkedInCards(CARD + '<li>garbage</li>' + CARD).length === 2,
  'one malformed card does not abort the batch'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node linkedin-guest-tests.mjs
```

Expected: FAIL with `Cannot find module ... providers/linkedin-guest.mjs`.

- [ ] **Step 3: Implement the provider**

Create `providers/linkedin-guest.mjs`:

```javascript
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// LinkedIn guest-endpoint provider — reads the PUBLIC, UNAUTHENTICATED job
// search fragment that backs linkedin.com's logged-out job search.
//
//   GET /jobs-guest/jobs/api/seeMoreJobPostings/search
//         ?keywords=<terms>&location=<place>&start=<offset>
//
// Returns an HTML fragment of <li> cards (NOT JSON), 10 per request.
//
// This provider never authenticates, so it carries no risk to the candidate's
// LinkedIn account. It is nonetheless BEST-EFFORT: the endpoint is undocumented
// and may rate-limit by IP or change shape without notice. scan.mjs treats a
// throwing provider as a non-fatal skip, which is the intended behaviour here.
//
// Requests are sequential with a delay between pages, and page count is capped.
// Uses career-ops' own User-Agent from _http.mjs — no browser spoofing.
//
// Portal entry fields (all optional except `provider`):
//   searchKeywords — search terms (default: '')
//   searchLocation — location filter (default: 'Singapore')
//   pageSize       — informational; the endpoint fixes this at 10
//   maxPages       — pages to fetch (default: 3)

const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const RESULTS_PER_PAGE = 10;
const DEFAULT_MAX_PAGES = 3;
const PAGE_DELAY_MS = 400;

const ALLOWED_LINKEDIN_HOST = /(^|\.)linkedin\.com$/;

/** Decode the handful of HTML entities that appear in these cards. */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Collapse whitespace and trim — card text is heavily indented. */
function clean(s) {
  return decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim();
}

/** First capture group of `re` against `s`, cleaned; '' when no match. */
function pick(s, re) {
  const m = s.match(re);
  return m ? clean(m[1]) : '';
}

// NaN-safe Date.parse, mirroring providers/jobstreet.mjs.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse the guest-endpoint HTML fragment into canonical Job objects.
 * Exported for unit testing.
 *
 * A malformed card is skipped rather than aborting the batch — a single
 * layout change on one row must not cost the whole page.
 *
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseLinkedInCards(html) {
  if (typeof html !== 'string' || !html) return [];

  const jobs = [];
  for (const chunk of html.split('<li>').slice(1)) {
    try {
      const title = pick(chunk, /base-search-card__title"[^>]*>([\s\S]*?)</);
      if (!title) continue;

      const rawHref = pick(chunk, /href="(https:\/\/[^"]*\/jobs\/view\/[^"]+)"/);
      if (!rawHref) continue;

      let url;
      try {
        const parsed = new URL(rawHref);
        if (parsed.protocol !== 'https:') continue;
        if (!ALLOWED_LINKEDIN_HOST.test(parsed.hostname)) continue;
        // Strip tracking query params — the bare path is the stable dedup key.
        url = `${parsed.origin}${parsed.pathname}`;
      } catch {
        continue;
      }

      const company = pick(chunk, /hidden-nested-link"[^>]*>([\s\S]*?)</);
      const location = pick(chunk, /job-search-card__location"[^>]*>([\s\S]*?)</);
      const postedAt = toEpochMs(pick(chunk, /datetime="([^"]+)"/));

      jobs.push({ title, url, company, location, ...(postedAt != null ? { postedAt } : {}) });
    } catch {
      // Skip this card, keep the rest.
      continue;
    }
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'linkedin-guest',

  detect(_entry) {
    // LinkedIn is an aggregator, not a company ATS. Require an explicit
    // `provider: linkedin-guest` in portals.yml, matching the jobstreet
    // precedent.
    return null;
  },

  async fetch(entry, ctx) {
    const keywords = entry.searchKeywords || '';
    const location = entry.searchLocation || 'Singapore';
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;

    const all = [];
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(SEARCH_URL);
      if (keywords) url.searchParams.set('keywords', keywords);
      if (location) url.searchParams.set('location', location);
      url.searchParams.set('start', String(page * RESULTS_PER_PAGE));

      let html;
      try {
        html = await ctx.fetchText(url.href);
      } catch (err) {
        // Page 1 failing is fatal for this entry; scan.mjs logs and moves on.
        // Later pages failing is non-fatal — keep what we have.
        if (page === 0) throw err;
        console.error(`linkedin-guest: page ${page + 1} failed — ${err.message}`);
        break;
      }

      const batch = parseLinkedInCards(html);
      if (batch.length === 0) break;
      all.push(...batch);

      if (batch.length < RESULTS_PER_PAGE) break;
      await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS));
    }

    return all;
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node linkedin-guest-tests.mjs
```

Expected: PASS, `13 passed, 0 failed`.

- [ ] **Step 5: Live smoke test**

```bash
node -e "Promise.all([import('./providers/linkedin-guest.mjs'),import('./providers/_http.mjs')]).then(async ([p,h])=>{const jobs=await p.default.fetch({searchKeywords:'software engineer',searchLocation:'Singapore',maxPages:1},h.makeHttpCtx());console.log('fetched',jobs.length);console.log(jobs.slice(0,3));})"
```

Expected: about 10 jobs, each with a `linkedin.com/jobs/view/...` url and no query string.

- [ ] **Step 6: Commit**

```bash
git add providers/linkedin-guest.mjs linkedin-guest-tests.mjs
git commit -m "feat(providers): add LinkedIn guest-endpoint provider

Reads the public unauthenticated job-search fragment that backs LinkedIn's
logged-out search. Never authenticates, so it carries no risk to the
candidate's account.

Best-effort by design: the endpoint is undocumented and may rate-limit or
change shape, so a failure is a non-fatal skip. Sequential requests with a
delay, capped page count, and career-ops' own User-Agent — no spoofing."
```

---

### Task 4: Configure `portals.yml` for Singapore

**Files:**
- Create: `portals.yml` (repo root — `scan.mjs` reads `process.env.CAREER_OPS_PORTALS || 'portals.yml'`; gitignored, user layer)

**Interfaces:**
- Consumes: `providers/jobstreet.mjs` (Task 1-2) and `providers/linkedin-guest.mjs` (Task 3) via the `provider:` key.
- Produces: the config consumed by `scan.mjs` and validated by `validate-portals.mjs`.

- [ ] **Step 1: Write the config**

```yaml
# portals.yml — Singapore-only job discovery.
#
# USER LAYER: gitignored, never touched by `npm run update`.
#
# Salary note: scan.mjs's salary_filter compares ANNUALIZED figures. The
# candidate's floor is SGD6000/month, hence 72000. That floor exists to clear
# Singapore's MOM Employment Pass qualifying salary — a lower number surfaces
# roles that legally cannot sponsor them. Re-verify against MOM before changing.
#
# Only ~31% of JobStreet listings post a salary at all, and jobs with no salary
# data PASS the filter by design (see spec). The digest labels those explicitly.

tracked_companies:
  - name: JobStreet SG — core engineering
    provider: jobstreet
    api: https://sg.jobstreet.com/api/jobsearch/v5/search
    siteKey: SG-Main
    searchKeywords: software engineer
    searchLocation: Singapore
    pageSize: 100
    maxPages: 2

  - name: JobStreet SG — full stack
    provider: jobstreet
    api: https://sg.jobstreet.com/api/jobsearch/v5/search
    siteKey: SG-Main
    searchKeywords: full stack developer
    searchLocation: Singapore
    pageSize: 100
    maxPages: 2

  - name: JobStreet SG — backend .NET
    provider: jobstreet
    api: https://sg.jobstreet.com/api/jobsearch/v5/search
    siteKey: SG-Main
    searchKeywords: backend engineer .NET C#
    searchLocation: Singapore
    pageSize: 100
    maxPages: 2

  - name: LinkedIn — software engineer SG
    provider: linkedin-guest
    searchKeywords: software engineer
    searchLocation: Singapore
    maxPages: 3

  - name: LinkedIn — full stack SG
    provider: linkedin-guest
    searchKeywords: full stack developer
    searchLocation: Singapore
    maxPages: 3

# -- Title filter --
# The 2026-08-20 scan surfaced an RM1,200 internship, which is why the
# internship negatives are here. The candidate held a Senior title
# (Hokenso, 2023-2025), so Senior postings are in band, not a stretch.
title_filter:
  positive:
    - engineer
    - developer
    - software
    - full stack
    - fullstack
    - backend
    - back end
  negative:
    - intern
    - internship
    - trainee
    - apprentice
    - graduate programme
    - graduate program
    - director
    - head of
    - vice president
    - vp
    - principal
    - engineering manager
    - architect
    - sales
    - recruiter
    - qa tester
    - support technician
  # NOTE: buildTitleFilter reads only `positive` and `negative`.
  # `seniority_boost` is consumed by the agent-level scan workflow described in
  # modes/scan.md, not by the zero-token scanner. Harmless to keep, but it does
  # not affect `npm run scan`.
  seniority_boost:
    - senior
    - mid
    - full stack
    - backend

# -- Location filter --
# KEY NAMES MATTER. buildLocationFilter reads `always_allow` / `allow` / `block`
# — NOT `positive`. A `positive:` key here is silently ignored, leaving
# `allow` empty, which passes EVERY location and quietly defeats the
# Singapore-only scope. Verified against scan.mjs's buildLocationFilter and
# templates/portals.example.yml.
location_filter:
  allow:
    - singapore
    - central region
    - east region
    - west region
    - north region
    - north-east region
  block:
    - malaysia
    - kuala lumpur
    - selangor
    - penang
    - johor

# -- Salary filter (ANNUALIZED) --
salary_filter:
  min: 72000      # SGD6000/month
  max: 0          # no upper limit
  currency: SGD
```

- [ ] **Step 2: Validate the config**

```bash
node validate-portals.mjs
```

Expected: no errors. If it reports unknown keys, reconcile against `templates/portals.example.yml` — that template is the schema of record.

- [ ] **Step 2b: Prove the filters actually filter**

`validate-portals.mjs` checks structure, **not** whether a key name is one the
scanner reads. A misspelled filter key is silently ignored and passes
everything. Assert real behaviour instead of trusting the config:

```bash
node -e "Promise.all([import('./scan.mjs'),import('js-yaml')]).then(async ([s,y])=>{const {readFileSync}=await import('fs');const c=y.default.load(readFileSync('portals.yml','utf8'));const t=s.buildTitleFilter(c.title_filter),l=s.buildLocationFilter(c.location_filter),m=s.buildSalaryFilter(c.salary_filter);const chk=[['title Software Engineer',t('Software Engineer'),true],['title Software Engineering Intern',t('Software Engineering Intern'),false],['title Head of Engineering',t('Head of Engineering'),false],['loc Singapore',l('Singapore'),true],['loc Central Region',l('Central Region'),true],['loc Kuala Lumpur, Malaysia',l('Kuala Lumpur, Malaysia'),false],['salary 84000 max',m({min:72000,max:84000,currency:'SGD'}),true],['salary 60000 max',m({min:42000,max:60000,currency:'SGD'}),false],['salary absent',m(null),true]];let bad=0;for(const [n,got,want] of chk){const ok=got===want;if(!ok)bad++;console.log((ok?'  ok  ':'  FAIL')+' '+n+' -> '+got+' (want '+want+')')}process.exit(bad?1:0)})"
```

Expected: every line `ok`, exit 0. A `FAIL` on any location line means the
`allow`/`block` keys are wrong — fix before scanning.

- [ ] **Step 3: Confirm it is gitignored**

```bash
git check-ignore -v portals.yml
```

Expected: a match on the `portals.yml` line in `.gitignore`. If there is no match, **stop** — the file holds no secrets but is user-layer and must not be committed.

- [ ] **Step 4: Live scan**

```bash
npm run scan
```

Expected: both providers report results, the filters drop some rows, and `data/pipeline.md` gains `- [ ] {url} | {company} | {title}` entries under `## Pending`.

- [ ] **Step 5: Verify the pipeline file**

```bash
head -20 data/pipeline.md && node verify-pipeline.mjs
```

Expected: well-formed pending rows and a clean verify.

- [ ] **Step 6: Commit**

`portals.yml` is gitignored, so there is nothing to commit. Confirm the tree is clean instead:

```bash
git status --short
```

Expected: no `portals.yml` entry. Record completion in the plan checkboxes only.

---

### Task 5: Build the Q&A knowledge base

Application forms repeat the same questions. This store answers the known ones automatically and grows when a new one appears, so the candidate is never asked twice.

**Files:**
- Create: `answers.mjs`
- Create: `answers-tests.mjs`
- Create: `data/answers.yml` (gitignored — personal data)
- Modify: `.gitignore` and `.git/info/exclude` (already done during design; verify)

**Interfaces:**
- Consumes: `js-yaml` (already a dependency).
- Produces:
  - `loadAnswers(path?)` → `Array<{q, match, scope, a?, updated}>`. Throws on malformed YAML.
  - `matchAnswer(entries, questionText)` → `{entry, index}|null`. Case-insensitive substring match on `match[]`; longest matching token wins.
  - `appendAnswer(entry, path?)` → `void`. Appends and rewrites the file.

- [ ] **Step 1: Write the failing test**

Create `answers-tests.mjs`:

```javascript
#!/usr/bin/env node
// @ts-check
/**
 * answers-tests.mjs — unit tests for the application Q&A knowledge base.
 * Run: node answers-tests.mjs
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadAnswers, matchAnswer, appendAnswer } from './answers.mjs';

let passed = 0;
let failed = 0;
function assert(condition, testName) {
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName}`); }
}
function section(name) { console.log(`\n━━━ ${name} ━━━`); }

const dir = mkdtempSync(join(tmpdir(), 'answers-'));
const file = join(dir, 'answers.yml');

const VALID = `- q: What is your notice period?
  match: [notice, availability, start date]
  scope: universal
  a: 2 months
  updated: 2026-08-20

- q: Why do you want to join {company}?
  match: [why, interested, motivat]
  scope: per-job
  updated: 2026-08-20
`;

section('loadAnswers');

writeFileSync(file, VALID, 'utf-8');
const entries = loadAnswers(file);
assert(entries.length === 2, 'loads both entries');
assert(entries[0].scope === 'universal', 'scope preserved');
assert(entries[0].a === '2 months', 'answer text preserved');

writeFileSync(file, '', 'utf-8');
assert(loadAnswers(file).length === 0, 'empty file → empty array');

section('loadAnswers — fails loudly, never silently empty');

writeFileSync(file, 'this: [is: not: valid\n  - yaml', 'utf-8');
let threw = false;
try { loadAnswers(file); } catch { threw = true; }
assert(threw, 'malformed YAML throws (never returns [] silently)');

writeFileSync(file, '- q: missing its match key\n  scope: universal\n', 'utf-8');
threw = false;
try { loadAnswers(file); } catch { threw = true; }
assert(threw, 'entry missing `match` throws');

writeFileSync(file, '- q: bad scope\n  match: [x]\n  scope: sometimes\n', 'utf-8');
threw = false;
try { loadAnswers(file); } catch { threw = true; }
assert(threw, 'invalid scope value throws');

section('matchAnswer');

writeFileSync(file, VALID, 'utf-8');
const loaded = loadAnswers(file);

assert(matchAnswer(loaded, 'What is your notice period?')?.entry.scope === 'universal', 'exact question matches');
assert(matchAnswer(loaded, 'NOTICE PERIOD') !== null, 'match is case-insensitive');
assert(matchAnswer(loaded, 'When is your earliest start date?') !== null, 'matches on a secondary token');
assert(matchAnswer(loaded, 'Why are you interested in this role?')?.entry.scope === 'per-job', 'per-job entry matches');
assert(matchAnswer(loaded, 'What is your favourite colour?') === null, 'unknown question → null');
assert(matchAnswer(loaded, '') === null, 'empty question → null');
assert(matchAnswer([], 'anything') === null, 'empty store → null');

section('matchAnswer — longest token wins');

const ambiguous = [
  { q: 'Generic why', match: ['why'], scope: 'per-job', updated: '2026-08-20' },
  { q: 'Specific relocation', match: ['why do you want to relocate'], scope: 'per-job', updated: '2026-08-20' },
];
assert(
  matchAnswer(ambiguous, 'Why do you want to relocate to Singapore?')?.entry.q === 'Specific relocation',
  'longest matching token wins over a shorter one'
);

section('appendAnswer');

writeFileSync(file, VALID, 'utf-8');
appendAnswer({
  q: 'Do you require visa sponsorship?',
  match: ['visa', 'sponsorship'],
  scope: 'universal',
  a: 'Yes — I would require a Singapore Employment Pass.',
  updated: '2026-08-20',
}, file);

const after = loadAnswers(file);
assert(after.length === 3, 'entry appended');
assert(matchAnswer(after, 'Do you require visa sponsorship?') !== null, 'appended entry is matchable');
assert(after[0].q === 'What is your notice period?', 'existing entries preserved and ordered');
assert(/Employment Pass/.test(readFileSync(file, 'utf-8')), 'answer text written to disk');

appendAnswer({ q: 'x', match: ['zzz'], scope: 'universal', a: 'y', updated: '2026-08-20' }, join(dir, 'new.yml'));
assert(loadAnswers(join(dir, 'new.yml')).length === 1, 'appending to a missing file creates it');

section('appendAnswer — validation');

threw = false;
try { appendAnswer({ q: 'no match key', scope: 'universal', updated: '2026-08-20' }, file); } catch { threw = true; }
assert(threw, 'appending an invalid entry throws');
assert(loadAnswers(file).length === 3, 'failed append did not corrupt the file');

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node answers-tests.mjs
```

Expected: FAIL with `Cannot find module ... answers.mjs`.

- [ ] **Step 3: Implement `answers.mjs`**

```javascript
// @ts-check
/**
 * answers.mjs — the application Q&A knowledge base.
 *
 * Application forms ask the same questions over and over. This store holds the
 * candidate's answers so known questions fill automatically and a new one is
 * asked exactly once.
 *
 * `data/answers.yml` holds PERSONAL DATA and is gitignored in both .gitignore
 * and .git/info/exclude. The double rule is deliberate: the career-ops updater
 * owns .gitignore and could revert a single entry.
 *
 * Entry shape:
 *   q       — the canonical question text (human-readable label)
 *   match   — list of case-insensitive substrings tested against a form's
 *             question text
 *   scope   — 'universal' (fill automatically) | 'per-job' (draft fresh from
 *             the job report; never auto-filled from a stale answer)
 *   a       — the answer text (required for 'universal', absent for 'per-job')
 *   updated — ISO date the entry was last touched
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';

export const DEFAULT_ANSWERS_PATH = 'data/answers.yml';

const VALID_SCOPES = new Set(['universal', 'per-job']);

/**
 * Validate one entry, throwing with a specific message on the first problem.
 * @param {any} entry
 * @param {number|string} where — index or 'input', for the error message
 */
function validateEntry(entry, where) {
  const at = `answers entry ${where}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${at}: must be a mapping`);
  }
  if (typeof entry.q !== 'string' || !entry.q.trim()) {
    throw new Error(`${at}: \`q\` must be a non-empty string`);
  }
  if (!Array.isArray(entry.match) || entry.match.length === 0) {
    throw new Error(`${at}: \`match\` must be a non-empty list`);
  }
  if (entry.match.some(m => typeof m !== 'string' || !m.trim())) {
    throw new Error(`${at}: every \`match\` token must be a non-empty string`);
  }
  if (!VALID_SCOPES.has(entry.scope)) {
    throw new Error(`${at}: \`scope\` must be 'universal' or 'per-job', got ${JSON.stringify(entry.scope)}`);
  }
  if (entry.scope === 'universal' && (typeof entry.a !== 'string' || !entry.a.trim())) {
    throw new Error(`${at}: a 'universal' entry needs a non-empty \`a\``);
  }
}

/**
 * Load and validate the store.
 *
 * Throws on malformed YAML or an invalid entry — it must NEVER fall back to an
 * empty list. A silent fallback would mean known answers go missing and wrong
 * or blank values get typed into a real job application.
 *
 * @param {string} [path]
 * @returns {Array<{q: string, match: string[], scope: string, a?: string, updated?: string}>}
 */
export function loadAnswers(path = DEFAULT_ANSWERS_PATH) {
  if (!existsSync(path)) return [];

  const raw = readFileSync(path, 'utf-8');
  if (!raw.trim()) return [];

  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`${path}: malformed YAML — ${err.message}`);
  }
  if (parsed == null) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: top level must be a list of entries`);
  }
  parsed.forEach((entry, i) => validateEntry(entry, i));
  return parsed;
}

/**
 * Find the entry whose `match` tokens best fit a form question.
 *
 * The LONGEST matching token wins, so a specific entry
 * ('why do you want to relocate') beats a generic one ('why'). Ties keep the
 * earlier entry.
 *
 * @param {Array<any>} entries
 * @param {string} questionText
 * @returns {{entry: any, index: number, token: string}|null}
 */
export function matchAnswer(entries, questionText) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (typeof questionText !== 'string' || !questionText.trim()) return null;

  const haystack = questionText.toLowerCase();
  let best = null;

  entries.forEach((entry, index) => {
    for (const token of entry.match || []) {
      const needle = String(token).toLowerCase().trim();
      if (!needle || !haystack.includes(needle)) continue;
      if (!best || needle.length > best.token.length) {
        best = { entry, index, token: needle };
      }
    }
  });

  return best;
}

/**
 * Append a validated entry and rewrite the file.
 *
 * Validation happens BEFORE any write, so a bad entry can never corrupt an
 * existing store.
 *
 * @param {any} entry
 * @param {string} [path]
 */
export function appendAnswer(entry, path = DEFAULT_ANSWERS_PATH) {
  validateEntry(entry, 'input');
  const existing = loadAnswers(path);
  existing.push(entry);
  writeFileSync(path, yaml.dump(existing, { lineWidth: 100, noRefs: true }), 'utf-8');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node answers-tests.mjs
```

Expected: PASS, `22 passed, 0 failed`.

- [ ] **Step 5: Confirm `data/answers.yml` is gitignored**

```bash
touch data/answers.yml && git check-ignore -v data/answers.yml
```

Expected: a match. If not, **stop and fix the ignore rules before writing any personal data.**

- [ ] **Step 6: Seed the store from `config/profile.yml`**

Write `data/answers.yml`. Every value below comes from `config/profile.yml` or was confirmed by the candidate — invent nothing.

```yaml
- q: What is your notice period?
  match: [notice period, notice, earliest start, start date, availability, when can you start]
  scope: universal
  a: 2 months
  updated: 2026-08-20

- q: Do you have the right to work in Singapore / require sponsorship?
  match: [right to work, work pass, work permit, visa, sponsorship, employment pass, eligible to work]
  scope: universal
  a: >-
    I am based in Malaysia and would require a Singapore Employment Pass.
    I do not currently hold Singapore PR or an Employment Pass.
  updated: 2026-08-20

- q: What are your salary expectations?
  match: [salary expectation, expected salary, expected compensation, desired salary, remuneration]
  scope: universal
  a: SGD 6,000 - 9,000 per month, negotiable depending on the overall package.
  updated: 2026-08-20

- q: How many years of experience do you have?
  match: [years of experience, how many years, total experience, relevant experience]
  scope: universal
  a: 5 years across the full software development lifecycle.
  updated: 2026-08-20

- q: Where are you currently located?
  match: [current location, where are you based, city of residence, present address]
  scope: universal
  a: Kuala Lumpur, Malaysia.
  updated: 2026-08-20

- q: Are you willing to relocate?
  match: [willing to relocate, relocation, prepared to move]
  scope: universal
  a: Yes — I am actively seeking roles in Singapore and am prepared to relocate.
  updated: 2026-08-20

- q: Who is your current employer and what is your current role?
  match: [current employer, current company, present employer, current role, current position]
  scope: universal
  a: Full Stack Software Engineer at Itechoice Sdn Bhd, Kuala Lumpur, since November 2025.
  updated: 2026-08-20

- q: What is your highest qualification?
  match: [highest qualification, education, degree, university, academic]
  scope: universal
  a: >-
    BSc Computer Science, University Malaysia of Computer Science & Engineering
    (2021), GPA 3.79/4.00.
  updated: 2026-08-20

- q: Why do you want to join {company}?
  match: [why do you want to join, why are you interested, why this company, what attracts you, motivation for applying]
  scope: per-job
  updated: 2026-08-20

- q: Why are you a good fit for this role?
  match: [good fit, why should we hire, suitable for this role, what makes you qualified]
  scope: per-job
  updated: 2026-08-20
```

- [ ] **Step 7: Verify the seed loads and matches**

```bash
node -e "import('./answers.mjs').then(m=>{const a=m.loadAnswers('data/answers.yml');console.log('entries',a.length);for(const q of ['What is your notice period?','Do you require visa sponsorship?','Expected salary?','Why do you want to join Grab?','What is your favourite colour?'])console.log(JSON.stringify(q),'->',m.matchAnswer(a,q)?.entry.scope ?? 'NO MATCH');})"
```

Expected: 10 entries; the first three match `universal`, the fourth `per-job`, the last `NO MATCH`.

- [ ] **Step 8: Commit**

`data/answers.yml` is gitignored and must not be committed.

```bash
git add answers.mjs answers-tests.mjs
git status --short   # confirm data/answers.yml is NOT staged
git commit -m "feat: add the application Q&A knowledge base

Application forms repeat the same questions. loadAnswers/matchAnswer/
appendAnswer let known questions fill automatically and a new one be asked
exactly once.

loadAnswers throws on malformed YAML rather than returning an empty list — a
silent fallback would mean blank or wrong values typed into a real job
application. Longest matching token wins so specific entries beat generic ones.

data/answers.yml holds personal data and stays gitignored."
```

---

### Task 6: Build the daily digest

**Files:**
- Create: `daily-digest.mjs`
- Create: `daily-digest-tests.mjs`

**Interfaces:**
- Consumes: `providers/jobstreet.mjs`, `providers/linkedin-guest.mjs`, `providers/_http.mjs` (`makeHttpCtx`), `scan.mjs` (`buildSalaryFilter`, `buildTitleFilter`, `buildLocationFilter` — all exported; its `main()` is guarded so importing does not trigger a scan), `role-matcher.mjs` (`roleTokens` — keeps baseline tokens like `software`/`engineer` in its output, which the scoring relies on), `js-yaml`.
- Produces:
  - `scoreJob(job, profile)` → `number` (triage score, 0-100)
  - `rankJobs(jobs, profile, limit)` → `Array<job & {score}>`
  - `renderDigest({jobs, applied, failures, date})` → `string` (complete HTML)
  - CLI: `node daily-digest.mjs` writes `output/digest-YYYY-MM-DD.html`

Note the ranking is a **triage heuristic, not the A-F fit score** — that score comes from the interactive evaluation, one job at a time. The digest must label it so the two are never confused.

- [ ] **Step 1: Write the failing test**

Create `daily-digest-tests.mjs`:

```javascript
#!/usr/bin/env node
// @ts-check
/**
 * daily-digest-tests.mjs — unit tests for daily digest ranking and rendering.
 * Run: node daily-digest-tests.mjs
 */

import { scoreJob, rankJobs, renderDigest, parseAppliedUrls, parsePendingUrls } from './daily-digest.mjs';

let passed = 0;
let failed = 0;
function assert(condition, testName) {
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName}`); }
}
function section(name) { console.log(`\n━━━ ${name} ━━━`); }

const PROFILE = {
  target_roles: {
    primary: ['Software Engineer', 'Full Stack Engineer', 'Backend Engineer'],
    archetypes: [
      { name: 'Full Stack Software Engineer (C#/.NET + TypeScript)', fit: 'primary' },
      { name: 'Backend Engineer (.NET / C#)', fit: 'primary' },
      { name: 'AI Engineer', fit: 'stretch' },
    ],
  },
  compensation: { minimum: 'SGD6000' },
};

const NOW = Date.parse('2026-08-20T00:00:00Z');
const job = (over = {}) => ({
  title: 'Software Engineer', url: 'https://sg.jobstreet.com/job/1',
  company: 'Acme', location: 'Singapore', postedAt: NOW, ...over,
});

section('scoreJob');

assert(
  scoreJob(job({ title: 'Full Stack Software Engineer' }), PROFILE, NOW)
  > scoreJob(job({ title: 'Data Entry Clerk' }), PROFILE, NOW),
  'title matching an archetype scores above an unrelated title'
);
assert(
  scoreJob(job({ salary: { min: 84000, max: 96000, currency: 'SGD' } }), PROFILE, NOW)
  > scoreJob(job(), PROFILE, NOW),
  'a salary clearing the floor scores above no salary data'
);
assert(
  scoreJob(job({ postedAt: NOW }), PROFILE, NOW)
  > scoreJob(job({ postedAt: NOW - 60 * 86400000 }), PROFILE, NOW),
  'a fresher posting scores above a 60-day-old one'
);
assert(Number.isFinite(scoreJob(job({ postedAt: undefined }), PROFILE, NOW)), 'missing postedAt still scores');
assert(Number.isFinite(scoreJob(job({ title: '' }), PROFILE, NOW)), 'empty title still scores (no crash)');

section('rankJobs');

const many = Array.from({ length: 25 }, (_, i) => job({ url: `https://sg.jobstreet.com/job/${i}` }));
assert(rankJobs(many, PROFILE, 10).length === 10, 'caps at the limit');
assert(rankJobs(many.slice(0, 4), PROFILE, 10).length === 4, 'fewer than the limit returns what exists (no padding)');
assert(rankJobs([], PROFILE, 10).length === 0, 'empty input → empty output');

const ranked = rankJobs(
  [job({ title: 'Data Entry Clerk', url: 'https://sg.jobstreet.com/job/a' }),
   job({ title: 'Senior Full Stack Software Engineer', url: 'https://sg.jobstreet.com/job/b' })],
  PROFILE, 10
);
assert(ranked[0].title === 'Senior Full Stack Software Engineer', 'sorted by score, highest first');
assert(typeof ranked[0].score === 'number', 'each ranked job carries its score');

section('parseAppliedUrls / parsePendingUrls');

const PENDING_MD = `# Pipeline — Pending URLs

## Pending
- [ ] https://sg.jobstreet.com/job/111 | Acme | Software Engineer
- [ ] https://sg.jobstreet.com/job/222 | Beta | Backend Engineer

## Processed
- [x] https://sg.jobstreet.com/job/999 | Old | Gone
`;
const pending = parsePendingUrls(PENDING_MD);
assert(pending.size === 2, 'reads only the Pending section');
assert(pending.has('https://sg.jobstreet.com/job/111'), 'pending url captured');
assert(!pending.has('https://sg.jobstreet.com/job/999'), 'Processed rows excluded');
assert(parsePendingUrls('').size === 0, 'empty pipeline → empty set');

const APPLIED_MD = `| Date | Company | Role | URL | Status |
|---|---|---|---|---|
| 2026-08-19 | Acme | Software Engineer | https://sg.jobstreet.com/job/111 | Applied |
`;
const applied = parseAppliedUrls(APPLIED_MD);
assert(applied.has('https://sg.jobstreet.com/job/111'), 'applied url captured from the tracker table');
assert(parseAppliedUrls('').size === 0, 'empty tracker → empty set');

section('renderDigest');

const html = renderDigest({
  jobs: rankJobs([job({ salary: { min: 84000, max: 96000, currency: 'SGD' } })], PROFILE, 10),
  applied: [{ company: 'Beta', title: 'Backend Engineer', url: 'https://x/1' }],
  failures: ['linkedin-guest: HTTP 429'],
  date: '2026-08-20',
});
assert(/^<!DOCTYPE html>/i.test(html.trim()), 'renders a complete HTML document');
assert(html.includes('2026-08-20'), 'includes the date');
assert(html.includes('Software Engineer'), 'includes the job title');
assert(/triage/i.test(html), 'labels the ranking as triage, not a fit score');
assert(html.includes('linkedin-guest: HTTP 429'), 'names the failed source');
assert(html.includes('Backend Engineer'), 'includes the applied-today section');
assert(/prefers-color-scheme/.test(html), 'is theme-aware');

const noSalary = renderDigest({ jobs: rankJobs([job()], PROFILE, 10), applied: [], failures: [], date: '2026-08-20' });
assert(/salary undisclosed/i.test(noSalary), 'labels an unpriced job explicitly');

const empty = renderDigest({ jobs: [], applied: [], failures: [], date: '2026-08-20' });
assert(/no new roles/i.test(empty), 'empty digest says so rather than rendering a blank table');

assert(
  !renderDigest({
    jobs: rankJobs([job({ company: '<script>alert(1)</script>' })], PROFILE, 10),
    applied: [], failures: [], date: '2026-08-20',
  }).includes('<script>alert(1)</script>'),
  'escapes HTML in job fields'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node daily-digest-tests.mjs
```

Expected: FAIL with `Cannot find module ... daily-digest.mjs`.

- [ ] **Step 3: Implement `daily-digest.mjs`**

```javascript
#!/usr/bin/env node
// @ts-check
/**
 * daily-digest.mjs — render the daily job digest.
 *
 * WHY THIS FETCHES INSTEAD OF READING THE SCAN OUTPUT
 *
 * The scan's durable outputs cannot produce this digest:
 *   - data/pipeline.md rows are `- [ ] {url} | {company} | {title}` — no
 *     salary, location, posted date, or score.
 *   - data/scan-history.tsv adds portal and location, but still no salary.
 *   - The A-F fit score does not exist at scan time. It comes from the
 *     interactive 6-block evaluation, one job at a time — the expensive step
 *     this digest exists to help the candidate avoid.
 *
 * Persisting those fields would mean editing scan.mjs, an upstream file that
 * `npm run update` overwrites. So this does its own zero-token provider pass
 * (negligible at one run per day), reusing the same providers and scan.mjs's
 * exported salary filter rather than reimplementing them, then intersects with
 * pipeline.md's Pending set so the scan stays authoritative on what is new.
 *
 * The ranking here is a TRIAGE heuristic, not the A-F fit score. The rendered
 * page labels it as such.
 *
 * Usage: node daily-digest.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import yaml from 'js-yaml';

import { makeHttpCtx } from './providers/_http.mjs';
import jobstreet from './providers/jobstreet.mjs';
import linkedinGuest from './providers/linkedin-guest.mjs';
// scan.mjs guards its main() behind an import.meta.url check (scan.mjs:1031),
// so importing it is safe — it does NOT trigger a scan. Verified: 14ms.
import { buildSalaryFilter, buildTitleFilter, buildLocationFilter } from './scan.mjs';
import { roleTokens } from './role-matcher.mjs';

const PROFILE_PATH = 'config/profile.yml';
const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLIED_PATH = 'data/applications.md';
const OUTPUT_DIR = 'output';
const TOP_N = 10;

const PROVIDERS = { jobstreet, 'linkedin-guest': linkedinGuest };

// ── Parsing the scan's durable files ────────────────────────────────

/**
 * URLs under `## Pending` in pipeline.md. Rows are
 * `- [ ] {url} | {company} | {title}`; the `## Processed` section is excluded.
 * @param {string} text
 * @returns {Set<string>}
 */
export function parsePendingUrls(text) {
  const urls = new Set();
  if (typeof text !== 'string' || !text) return urls;

  const start = text.indexOf('## Pending');
  if (start === -1) return urls;
  const after = start + '## Pending'.length;
  const next = text.indexOf('\n## ', after);
  const section = text.slice(after, next === -1 ? undefined : next);

  for (const line of section.split('\n')) {
    const m = line.match(/^\s*-\s*\[[ x]\]\s*(https?:\/\/\S+)/i);
    if (m) urls.add(m[1].trim());
  }
  return urls;
}

/**
 * URLs already in the application tracker, in any markdown-table column.
 * @param {string} text
 * @returns {Set<string>}
 */
export function parseAppliedUrls(text) {
  const urls = new Set();
  if (typeof text !== 'string' || !text) return urls;
  for (const m of text.matchAll(/https?:\/\/[^\s|)\]]+/g)) urls.add(m[0].trim());
  return urls;
}

// ── Triage scoring ─────────────────────────────────────────────────

/**
 * Score a job for triage ordering, 0-100. NOT the A-F fit score.
 *
 * Three signals: title overlap with target roles and archetypes (dominant),
 * whether a posted salary clears the floor, and recency.
 *
 * @param {any} job
 * @param {any} profile — parsed config/profile.yml
 * @param {number} now — epoch ms, injected for deterministic tests
 * @returns {number}
 */
export function scoreJob(job, profile, now = Date.now()) {
  const title = String(job?.title || '');
  const titleTokens = new Set(roleTokens(title));

  const targets = [
    ...(profile?.target_roles?.primary || []),
    ...(profile?.target_roles?.archetypes || [])
      .filter(a => a?.fit === 'primary' || a?.fit === 'secondary')
      .map(a => a?.name || ''),
  ];

  let bestOverlap = 0;
  for (const target of targets) {
    const wanted = roleTokens(String(target));
    if (wanted.length === 0) continue;
    const hits = wanted.filter(t => titleTokens.has(t)).length;
    bestOverlap = Math.max(bestOverlap, hits / wanted.length);
  }
  const titleScore = bestOverlap * 60;

  // Salary: a posted figure clearing the floor is a positive signal. No posted
  // salary is neutral, never a penalty — ~69% of listings post nothing.
  const floorAnnual = parseFloorAnnual(profile);
  let salaryScore = 10;
  if (job?.salary && Number.isFinite(job.salary.max)) {
    salaryScore = job.salary.max >= floorAnnual ? 25 : 0;
  }

  // Recency: full marks today, decaying to zero at 45 days.
  let recencyScore = 7;
  if (Number.isFinite(job?.postedAt)) {
    const ageDays = Math.max(0, (now - job.postedAt) / 86400000);
    recencyScore = Math.max(0, 15 * (1 - ageDays / 45));
  }

  return Math.round(titleScore + salaryScore + recencyScore);
}

/** Annual salary floor from profile.compensation.minimum ("SGD6000" → 72000). */
function parseFloorAnnual(profile) {
  const raw = String(profile?.compensation?.minimum || '');
  const n = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const period = String(profile?.compensation?.period || 'monthly');
  return /month/i.test(period) ? n * 12 : n;
}

/**
 * Sort by score descending and cap. Never pads.
 * @param {Array<any>} jobs
 * @param {any} profile
 * @param {number} limit
 * @param {number} [now]
 */
export function rankJobs(jobs, profile, limit = TOP_N, now = Date.now()) {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .map(j => ({ ...j, score: scoreJob(j, profile, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── Rendering ──────────────────────────────────────────────────────

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Human-readable monthly SGD from an annualized salary object. */
function salaryText(salary) {
  if (!salary || !Number.isFinite(salary.min)) return null;
  const fmt = (n) => Math.round(n / 12).toLocaleString('en-SG');
  return salary.min === salary.max
    ? `SGD ${fmt(salary.min)}/mo`
    : `SGD ${fmt(salary.min)} – ${fmt(salary.max)}/mo`;
}

/**
 * Render the complete digest page.
 * @param {{jobs: Array<any>, applied: Array<any>, failures: string[], date: string}} args
 * @returns {string}
 */
export function renderDigest({ jobs, applied, failures, date }) {
  const rows = (jobs || []).map((j, i) => {
    const sal = salaryText(j.salary);
    return `      <tr>
        <td class="num">${i + 1}</td>
        <td><a href="${escapeHtml(j.url)}" target="_blank" rel="noopener">${escapeHtml(j.title)}</a></td>
        <td>${escapeHtml(j.company) || '<span class="muted">unknown</span>'}</td>
        <td>${escapeHtml(j.location)}</td>
        <td>${sal ? escapeHtml(sal) : '<span class="muted">salary undisclosed</span>'}</td>
        <td>${j.postedAt ? new Date(j.postedAt).toISOString().slice(0, 10) : '<span class="muted">—</span>'}</td>
        <td class="num">${j.score}</td>
      </tr>`;
  }).join('\n');

  const body = (jobs || []).length === 0
    ? `<p class="empty">No new roles today. Nothing matched the filters that you have not already applied to.</p>`
    : `<table>
      <thead>
        <tr><th>#</th><th>Role</th><th>Company</th><th>Location</th><th>Salary</th><th>Posted</th><th>Triage</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`;

  const appliedSection = (applied || []).length === 0
    ? ''
    : `<h2>Applied today</h2>
    <ul class="applied">
${applied.map(a => `      <li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a> — ${escapeHtml(a.company)}</li>`).join('\n')}
    </ul>`;

  const failureSection = (failures || []).length === 0
    ? ''
    : `<div class="warn"><strong>Some sources failed.</strong> This list may be short for that reason, not because the market was quiet.
      <ul>
${failures.map(f => `        <li>${escapeHtml(f)}</li>`).join('\n')}
      </ul>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job digest — ${escapeHtml(date)}</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --line: #e5e7eb;
    --accent: #1d4ed8; --warn-bg: #fef3c7; --warn-fg: #78350f; --head: #f9fafb;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --fg: #e6e6e6; --muted: #9ca3af; --line: #262b33;
      --accent: #7aa2ff; --warn-bg: #3a2e10; --warn-fg: #fde68a; --head: #171a20;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem; background: var(--bg); color: var(--fg);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  main { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
  .sub { color: var(--muted); margin: 0 0 1.5rem; }
  .tablewrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 720px; }
  th, td { text-align: left; padding: .55rem .7rem; border-bottom: 1px solid var(--line); }
  th { background: var(--head); font-weight: 600; font-size: .82rem; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
  td.num, th:first-child { text-align: right; font-variant-numeric: tabular-nums; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: var(--muted); }
  .warn { background: var(--warn-bg); color: var(--warn-fg); padding: .8rem 1rem; border-radius: 6px; margin-bottom: 1.25rem; }
  .warn ul { margin: .4rem 0 0; padding-left: 1.1rem; }
  .empty { color: var(--muted); padding: 2rem 0; }
  .applied { padding-left: 1.1rem; }
  footer { margin-top: 2.5rem; color: var(--muted); font-size: .85rem; border-top: 1px solid var(--line); padding-top: 1rem; }
</style>
</head>
<body>
<main>
  <h1>Job digest — ${escapeHtml(date)}</h1>
  <p class="sub">Singapore roles you have not applied to yet.</p>
  ${failureSection}
  ${body}
  ${appliedSection}
  <footer>
    <p><strong>Triage</strong> is a cheap local ordering from title match, posted salary, and recency.
    It is <strong>not</strong> the A&ndash;F fit score, which comes from the full evaluation of a single role.</p>
    <p>Jobs with no posted salary pass the filter by design and are marked
    &ldquo;salary undisclosed&rdquo; &mdash; roughly two thirds of listings post nothing,
    so the floor is unverified for those.</p>
  </footer>
</main>
</body>
</html>
`;
}

// ── CLI ────────────────────────────────────────────────────────────

async function main() {
  const profile = yaml.load(readFileSync(PROFILE_PATH, 'utf-8')) || {};
  const portals = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};

  const pending = existsSync(PIPELINE_PATH)
    ? parsePendingUrls(readFileSync(PIPELINE_PATH, 'utf-8')) : new Set();
  const applied = existsSync(APPLIED_PATH)
    ? parseAppliedUrls(readFileSync(APPLIED_PATH, 'utf-8')) : new Set();

  const ctx = makeHttpCtx();
  // Reuse all three of scan.mjs's filters. The pipeline.md intersection below
  // already implies them for scanned jobs, but on a first run (empty pipeline)
  // we fall through and show everything — without these, that path would be
  // unfiltered and could surface internships or non-SG roles.
  const salaryOk = buildSalaryFilter(portals.salary_filter);
  const titleOk = buildTitleFilter(portals.title_filter);
  const locationOk = buildLocationFilter(portals.location_filter);
  const failures = [];
  const seen = new Set();
  const collected = [];

  for (const entry of portals.tracked_companies || []) {
    if (entry.enabled === false) continue;
    const provider = PROVIDERS[entry.provider];
    if (!provider) {
      failures.push(`${entry.name}: unknown provider "${entry.provider}"`);
      continue;
    }
    try {
      for (const job of await provider.fetch(entry, ctx)) {
        if (seen.has(job.url) || applied.has(job.url)) continue;
        // pipeline.md stays authoritative on what counts as new. When it is
        // empty (first run, before any scan) fall through and show everything
        // that clears the filters below.
        if (pending.size > 0 && !pending.has(job.url)) continue;
        if (!titleOk(job.title)) continue;
        if (!locationOk(job.location)) continue;
        if (!salaryOk(job.salary)) continue;
        seen.add(job.url);
        collected.push(job);
      }
    } catch (err) {
      failures.push(`${entry.name} (${entry.provider}): ${err.message}`);
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const html = renderDigest({
    jobs: rankJobs(collected, profile, TOP_N),
    applied: [],
    failures,
    date,
  });

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, `digest-${date}.html`);
  writeFileSync(outPath, html, 'utf-8');

  console.log(`Digest written: ${outPath}`);
  console.log(`  candidates: ${collected.length}, shown: ${Math.min(collected.length, TOP_N)}`);
  if (failures.length) console.log(`  failed sources: ${failures.length}`);
}

// Run only when invoked directly, so tests can import the pure functions.
// pathToFileURL rather than string interpolation — matches scan.mjs:1031 and
// survives paths containing spaces.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node daily-digest-tests.mjs
```

Expected: PASS, `26 passed, 0 failed`.

- [ ] **Step 5: Generate a real digest**

```bash
node daily-digest.mjs && open "output/digest-$(date +%Y-%m-%d).html"
```

Expected: a readable page with up to 10 Singapore roles, salaries in monthly SGD, unpriced roles marked, and the triage footnote.

- [ ] **Step 6: Commit**

```bash
git add daily-digest.mjs daily-digest-tests.mjs
git commit -m "feat: add the daily job digest

Renders output/digest-YYYY-MM-DD.html with the top 10 Singapore roles not
yet applied to.

Does its own zero-token provider pass rather than reading the scan output:
pipeline.md carries only url|company|title, scan-history.tsv adds no salary,
and the A-F fit score does not exist until the interactive evaluation runs.
Reuses scan.mjs's salary filter and role-matcher's tokenizer instead of
reimplementing them, and intersects pipeline.md's Pending set so the scan
stays authoritative on what is new.

Ranking is a labelled triage heuristic, never presented as the A-F score."
```

---

### Task 7: Write the interactive playbook skill

**Files:**
- Create: `.claude/skills/daily-jobs/SKILL.md`

**Interfaces:**
- Consumes: everything from Tasks 1-6, plus career-ops' existing `modes/_shared.md`, `modes/_profile.md`, `modes/apply.md`, `voice-dna.md`, `check-liveness.mjs`, `generate-pdf.mjs`, `generate-cover-letter.mjs`, `tracker.mjs`.
- Produces: a user-invocable skill.

This is a new file inside a `SYSTEM_PATHS` directory, so it survives `npm run update`. Do **not** add a row to `.claude/skills/career-ops/SKILL.md` — that file exists upstream and the row would be overwritten.

- [ ] **Step 1: Write the skill**

```markdown
---
name: daily-jobs
description: Daily Singapore job routine — review the morning digest, tailor material for chosen roles, and assist the application under two approval gates. Use when the user wants to review today's jobs, apply to a role, or asks about their job search pipeline.
user_invocable: true
---

# Daily Jobs — Singapore Routine

Read `modes/_shared.md` and `modes/_profile.md` FIRST. They carry the scoring
rules, sources of truth, and the `voice-dna.md` anti-slop guardrail that all
candidate-facing text must obey.

Run everything from the career-ops project root.

## Non-negotiable rules

1. **Never submit an application without explicit approval for that specific
   application.** Approval for one job never carries to another.
2. **Never solve a CAPTCHA.** Stop and hand control to the candidate.
3. **Never enter a password, create an account, or log in.** Work only in
   browser sessions the candidate has already authenticated. If a login wall
   appears, stop and ask them to log in.
4. **Never invent a résumé fact.** The resume carries exactly one hard metric
   (up to 30% performance gains at Itechoice). Everything else must trace to
   `cv.md`, `config/profile.yml`, or `data/answers.yml`.
5. **Never present the triage score as a fit score.** Triage is cheap title and
   salary ordering. The A–F score requires the full evaluation.

## Step 1 — Show the digest

Read `output/digest-<today>.html`. If it does not exist, the scheduled scan has
not run; offer to run it now:

```bash
npm run scan && node daily-digest.mjs
```

Summarise the top 10 in chat as a compact table: rank, role, company, salary (or
"undisclosed"), posted date. Say plainly how many roles were found and whether
any source failed.

## Step 2 — Let the candidate choose

Ask which roles they want to pursue. Accept several. Do not evaluate anything
they did not pick — evaluation is the expensive step.

## Step 3 — Evaluate and verify each chosen role

For each pick, in order:

1. Run the career-ops evaluation (`modes/oferta.md` via the `career-ops` skill,
   or `auto-pipeline` from the URL) for the A–F score and the Block G
   scam / ghost-job check.
2. Verify the posting is still live **before** generating anything:
   ```bash
   node check-liveness.mjs --url "<job url>"
   ```
   If it is dead, say so and drop it. Do not spend a tailored CV on a closed role.
3. Report the A–F score. If it is below 4.0, say so and recommend against
   applying — but the decision is the candidate's.

## Step 4 — Generate material — GATE 1

Generate the tailored CV and cover letter:

```bash
node generate-pdf.mjs --report reports/<report>.md
node generate-cover-letter.mjs --report reports/<report>.md
```

Show the candidate both, then **STOP**. Do not open a form until they approve
this material. If they want changes, revise and show again.

## Step 5 — Fill the form

Only after gate 1 passes.

1. Ask the candidate to open the application page in their browser and confirm
   they are logged in. Never log in yourself.
2. Read the form and enumerate **every** question.
3. Run the `modes/apply.md` preflight: confirm the visible company and role
   match the evaluated report. On a material mismatch, stop and ask whether to
   re-evaluate, adapt, or abort.
4. For each question, resolve an answer in this order:
   - `matchAnswer` against `data/answers.yml`:
     ```bash
     node -e "import('./answers.mjs').then(m=>{const a=m.loadAnswers();console.log(JSON.stringify(m.matchAnswer(a,process.argv[1]),null,2))})" "<question text>"
     ```
   - `scope: universal` → fill its `a` verbatim.
   - `scope: per-job` → draft fresh from this job's report. Never reuse a stale
     per-job answer. Apply `voice-dna.md`.
   - **No match** → ask the candidate. Then persist it so it is never asked
     again:
     ```bash
     node -e "import('./answers.mjs').then(m=>m.appendAnswer({q:process.argv[1],match:JSON.parse(process.argv[2]),scope:process.argv[3],a:process.argv[4],updated:new Date().toISOString().slice(0,10)}))" "<q>" '["token1","token2"]' universal "<answer>"
     ```
     Choose `match` tokens that are specific enough not to collide with an
     existing entry. Prefer `universal` only when the answer is genuinely
     job-independent.
5. Fill the fields. State which `answers.yml` entry matched each one, so a
   wrong match is visible rather than silent.

## Step 6 — Review and submit — GATE 2

1. Present every filled field for review, plus anything left blank.
2. **STOP.** Wait for explicit approval of *this* application.
3. On approval, click submit. On a CAPTCHA, stop and hand over.
4. If they want edits, change them and present again.

## Step 7 — Record and report

After a confirmed submission:

1. Add it to the tracker:
   ```bash
   node tracker.mjs add --url "<url>" --company "<company>" --role "<role>" --status Applied
   ```
2. Regenerate the digest so it reflects the submission:
   ```bash
   node daily-digest.mjs
   ```
3. Give the candidate the digest path and a one-line summary of what was
   submitted.

## When something goes wrong

| Situation | Do this |
|-----------|---------|
| Digest missing | Offer to run the scan; do not fabricate a list |
| A source failed | Say which one. A short list may be a failure, not a quiet market |
| Posting dead | Drop it before generating material |
| CAPTCHA | Stop, hand over, never attempt it |
| Login wall | Stop, ask them to log in, never touch credentials |
| Company/role mismatch | Stop before drafting; ask how to proceed |
| Form question you cannot answer | Ask. Never guess on a real application |
| `answers.yml` fails to load | Stop. Report the error. Never proceed with an empty store — that would blank out real answers |
```

- [ ] **Step 2: Verify the skill is discoverable**

```bash
test -f .claude/skills/daily-jobs/SKILL.md && head -5 .claude/skills/daily-jobs/SKILL.md
```

Expected: valid YAML frontmatter with `name`, `description`, `user_invocable`.

- [ ] **Step 3: Confirm the router was NOT edited**

```bash
git diff --stat .claude/skills/career-ops/SKILL.md
```

Expected: no output. Editing that file would have the row overwritten on update.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/daily-jobs/SKILL.md
git commit -m "feat: add the daily-jobs interactive playbook skill

Encodes the six interactive steps, both approval gates, the halt conditions,
and the answers.yml read/append protocol.

A new standalone skill file rather than a modes/ entry plus a router row:
.claude/skills/career-ops/SKILL.md exists upstream, so a router row would be
overwritten by npm run update, silently breaking the entry point. New files
inside SYSTEM_PATHS directories survive."
```

---

### Task 8: Schedule the daily scan

The scheduled half is unattended-safe: it only reads public endpoints and writes local files. It submits nothing and needs no approval.

**Files:** none created. This registers a scheduled task.

- [ ] **Step 1: Verify the unattended chain runs clean end to end**

```bash
npm run scan && node daily-digest.mjs
```

Expected: exit code 0 and a fresh `output/digest-<today>.html`. **Do not schedule anything until this passes**, or the schedule will fail silently every morning.

- [ ] **Step 2: Confirm the exact command and its absolute paths**

The scheduled job must `cd` to the project root, since every path in `daily-digest.mjs` is relative:

```bash
cd /Users/cwai/Documents/Development/Projects/career-ops && npm run scan && node daily-digest.mjs
```

- [ ] **Step 3: Register the schedule**

Ask the candidate which mechanism they want, and confirm before creating it:

- **Claude Code scheduled task** — use the `mcp__scheduled-tasks__create_scheduled_task` tool, daily at 07:00 `Asia/Kuala_Lumpur`, with the Step 2 command.
- **System `launchd`/`cron`** — the candidate creates it themselves. Provide the command; do not modify their system configuration without asking.

Scheduling is an outward-facing, persistent change. Confirm before creating it.

- [ ] **Step 4: Verify the schedule exists**

List scheduled tasks and confirm the entry, its 07:00 `Asia/Kuala_Lumpur` timing, and its command.

- [ ] **Step 5: Run the whole suite once more**

```bash
node jobstreet-provider-tests.mjs && node linkedin-guest-tests.mjs && node answers-tests.mjs && node daily-digest-tests.mjs && node doctor.mjs
```

Expected: every suite reports `0 failed`. `doctor.mjs` should no longer flag `portals.yml`. It may still flag `modes/_profile.md` and the Playwright MCP server — both are pre-existing and out of scope, so report them rather than fixing them here.

- [ ] **Step 6: Commit**

Nothing to commit if the schedule lives outside the repo. Confirm and record:

```bash
git status --short && git log --oneline -8
```

---

## Verification checklist

Run before declaring the work done:

```bash
cd /Users/cwai/Documents/Development/Projects/career-ops
node jobstreet-provider-tests.mjs
node linkedin-guest-tests.mjs
node answers-tests.mjs
node daily-digest-tests.mjs
node validate-portals.mjs
node verify-pipeline.mjs
node doctor.mjs
npm run scan && node daily-digest.mjs
git check-ignore -v portals.yml data/answers.yml   # BOTH must match
```

Every suite must report `0 failed`, and both user-layer files must be ignored.
