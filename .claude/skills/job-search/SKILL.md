---
name: job-search
description: Run a fresh Singapore job scan on demand and present the digest by source. Use when the user wants to search for jobs now rather than wait for the 9pm scheduled run, asks "what jobs are there today", or wants the digest regenerated after changing queries or filters.
user_invocable: true
---

# Job Search — on-demand scan

The 9pm scheduled task produces the digest unattended. This skill does the same
thing on demand, and is also what to run after editing `portals.yml`.

Run everything from the career-ops project root.

## 1. Decide whether a scan is actually needed

Compute today's digest path using the candidate's timezone — 9pm local is the
previous day in UTC, so a naive date is wrong roughly a third of the time:

```bash
node -e "Promise.all([import('./daily-digest.mjs'),import('js-yaml')]).then(async([d,y])=>{const {readFileSync}=await import('fs');console.log('output/digest-'+d.digestDate(y.default.load(readFileSync('config/profile.yml','utf8')))+'.html')})"
```

If that file exists and the user just wants to see it, read it — do not rescan.
Rescan when: the file is missing, `portals.yml` changed, or they explicitly ask
for fresh results.

## 2. Scan, then build the digest

```bash
npm run scan && node daily-digest.mjs
```

**Rows per section are configurable.** The digest shows 10 per source by
default. Override for one run, or set a persistent default:

```bash
node daily-digest.mjs --top 20          # this run only
```

```yaml
# portals.yml — persists, and the 9pm scheduled task picks it up
digest_top_n: 20
```

Precedence is `--top` > `digest_top_n` > 10. It is **per source, not a grand
total**: with four sections, `--top 20` yields up to 80 rows. A non-integer or
zero value throws rather than silently falling back to 10, so a typo is visible
instead of looking like it worked.

Raising it costs nothing extra to fetch — scanning and ranking already process
every candidate, and this only changes how many survive into the HTML.

**Order matters and the two are not interchangeable.** `scan.mjs` writes
`data/pipeline.md`; `daily-digest.mjs` then does its own provider pass and keeps
only jobs that are ALSO in `pipeline.md`. A digest run without a preceding scan
silently drops anything new — this is exactly why a newly added provider shows
`shown 0` on its first run.

Both re-fetch every query, so the pair takes minutes and grows with each query
added. Expect the scan to exceed a 120s foreground timeout; run it in the
background rather than shortening the timeout.

## 3. Present the digest by source

The digest has four independently ranked sections: **JobStreet**, **LinkedIn —
Easy Apply**, **LinkedIn — apply on company site**, **foundit**. Summarise each
separately as a compact table: rank, role, company, salary, posted date, triage.

Three things to state plainly every time:

- **Triage is not a fit score.** It sees title, salary and date only, and has
  never read a job description. The A–F evaluation is the expensive step that
  actually judges fit.
- **Scores are not comparable across sections.** LinkedIn never publishes
  salary so its rows lean on estimates, which score lower by design.
- **Which salaries are posted and which are estimated.** An estimate renders as
  `~SGD X – Y/mo (est.)`. Never present one as a posted figure.

Say how many candidates were found and whether any source failed. A short list
after a failure is an outage, not a quiet market — say which source broke.

## 4. Hand off

Numbering restarts in every section, so a bare number is ambiguous. Tell the
user to name the source with the rank (`JS7`, `foundit 3`, `LI2`) or name the
role. Nothing is evaluated, generated or applied for until they choose —
that is the `daily-jobs` skill, which they invoke themselves.

## Coverage is only as good as the queries

`portals.yml` decides what is FETCHED; `title_filter` only decides what
survives. A role nobody searches for can never appear however well it matches.
When the user says a whole category seems missing, check the query list before
concluding the market is thin:

```bash
python3 -c "
import yaml
p=yaml.safe_load(open('portals.yml'))
for e in p.get('tracked_companies',[]):
    if e.get('provider') in ('jobstreet','linkedin-guest','foundit'):
        print(f\"{e['provider']:<15} {e.get('searchKeywords')}\")"
```

To measure whether a gap is real, ask a provider directly rather than guessing.
foundit's endpoint returns a total count and needs three headers — without them
it answers `{"error":400,"message":"content negotiation failed"}`, which reads
like a bad query rather than a missing header:

```bash
curl -s -H 'Accept: */*' -H 'Referer: https://www.foundit.sg/srp/results' \
  -H 'X-Requested-With: XMLHttpRequest' \
  'https://www.foundit.sg/middleware/jobsearch?start=0&limit=1&query=.net%20developer&locations=Singapore' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).jobSearchResponse.meta.paging.total))"
```

After changing `portals.yml`, always `node validate-portals.mjs`, then **test the
filter's behaviour, not just its config** — `location_filter` silently ignores a
`positive:` key, so a scope that looks applied can be a no-op:

```bash
node --input-type=module -e "
import {readFileSync} from 'node:fs'; import yaml from 'js-yaml';
import {buildTitleFilter} from './scan.mjs';
const f=buildTitleFilter(yaml.load(readFileSync('portals.yml','utf8')).title_filter);
for (const t of ['Software Engineer','C# / SQL Server Consultant','Mechanical Engineer','Software Engineering Intern'])
  console.log((f(t)?'PASS':'drop')+'  '+t);"
```
