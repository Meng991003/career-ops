// tests/digest-applied-exclusion.test.mjs — the digest must exclude a posting
// the candidate already applied to even when the tracker and the provider spell
// its URL differently. LinkedIn serves one posting from every locale subdomain
// under any slug, so raw string equality silently let Applied roles resurface.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nDigest — applied-exclusion keys on canonical posting URLs');

try {
  const { normalizeUrl } = await import(pathToFileURL(join(ROOT, 'url-key.mjs')).href);
  const { collectJobs } = await import(pathToFileURL(join(ROOT, 'daily-digest.mjs')).href);

  // --- url-key: the two spellings of one LinkedIn posting collapse to one key
  const trackerForm = 'https://www.linkedin.com/jobs/view/4454544388/';
  const providerForm = 'https://sg.linkedin.com/jobs/view/software-engineer-payments-at-stripe-4454544388';
  if (normalizeUrl(trackerForm) === normalizeUrl(providerForm) && normalizeUrl(trackerForm)) {
    pass('normalizeUrl collapses locale subdomain + slug to the posting id');
  } else {
    fail(`LinkedIn forms should share a key: ${normalizeUrl(trackerForm)} vs ${normalizeUrl(providerForm)}`);
  }

  // Two DIFFERENT postings must never collide — the failure direction url-key's
  // header says to avoid at all costs.
  if (normalizeUrl(providerForm) !== normalizeUrl('https://sg.linkedin.com/jobs/view/software-engineer-at-autodesk-4450091591')) {
    pass('normalizeUrl keeps two different LinkedIn postings distinct');
  } else {
    fail('two different LinkedIn ids collapsed to the same key');
  }

  // A LinkedIn URL with no posting id must not be forced into the id form.
  const noId = 'https://sg.linkedin.com/jobs/search?keywords=engineer';
  if (normalizeUrl(noId).includes('/jobs/search')) pass('normalizeUrl leaves non-posting LinkedIn URLs alone');
  else fail(`non-posting LinkedIn URL was rewritten: ${normalizeUrl(noId)}`);

  // --- collectJobs: the applied posting is dropped, the fresh one survives
  const applied = new Set([trackerForm]);          // as the tracker records it
  const pending = new Set([                         // as pipeline.md records it
    providerForm,
    'https://sg.linkedin.com/jobs/view/software-engineer-at-autodesk-4450091591',
  ]);
  const provider = {
    fetch: async () => ([
      { title: 'Software Engineer, Payments', company: 'Stripe', location: 'Singapore', url: providerForm },
      { title: 'Software Engineer', company: 'Autodesk', location: 'Singapore', url: 'https://sg.linkedin.com/jobs/view/software-engineer-at-autodesk-4450091591' },
    ]),
  };
  const { jobs } = await collectJobs({
    portals: { tracked_companies: [{ name: 'LI', provider: 'li' }] },
    ctx: {},
    pending,
    applied,
    titleOk: () => true,
    locationOk: () => true,
    salaryOk: () => true,
    providers: { li: provider },
  });

  if (jobs.length === 1 && jobs[0].company === 'Autodesk') {
    pass('collectJobs excludes the already-applied posting and keeps the new one');
  } else {
    fail(`expected only Autodesk, got ${JSON.stringify(jobs.map(j => j.company))}`);
  }

  // The pipeline intersection must still work through the same key, or the
  // digest silently renders zero rows (the documented "shown 0" failure).
  const { jobs: none } = await collectJobs({
    portals: { tracked_companies: [{ name: 'LI', provider: 'li' }] },
    ctx: {},
    pending: new Set(['https://sg.linkedin.com/jobs/view/unrelated-role-4000000001']),
    applied: new Set(),
    titleOk: () => true,
    locationOk: () => true,
    salaryOk: () => true,
    providers: { li: provider },
  });
  if (none.length === 0) pass('collectJobs still honours the pipeline.md intersection');
  else fail(`postings absent from pipeline.md should not appear, got ${none.length}`);

  // --- pickAppliedToday: "posted:" ahead of "Applied" must not win (row 471)
  const { pickAppliedToday } = await import(pathToFileURL(join(ROOT, 'daily-digest.mjs')).href);
  const picked = pickAppliedToday([{
    date: '2026-09-18', company: 'Synapxe', role: 'Engineer', urls: ['https://a.b/c'],
    notes: 'x; posted: 2026-09-18; Applied 2026-09-23 via portal. https://a.b/c',
  }], '2026-09-23');
  if (picked.length === 1) pass('pickAppliedToday prefers "Applied" date over an earlier "posted:" date');
  else fail(`expected the row applied 2026-09-23, got ${JSON.stringify(picked)}`);

} catch (e) {
  fail(`digest applied-exclusion tests crashed: ${e.message}`);
}
