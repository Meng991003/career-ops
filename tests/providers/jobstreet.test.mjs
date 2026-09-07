// tests/providers/jobstreet.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobstreet');


try {
  const jobstreetModule = await import(pathToFileURL(join(ROOT, 'providers/jobstreet.mjs')).href);
  const jobstreet = jobstreetModule.default;
  const { parseJobstreetItem } = jobstreetModule;

  // id check
  if (jobstreet.id === 'jobstreet') pass('jobstreet.id is "jobstreet"');
  else fail(`jobstreet.id is ${JSON.stringify(jobstreet.id)}`);

  // detect() always returns null (job board, not ATS)
  if (jobstreet.detect({ name: 'X', careers_url: 'https://id.jobstreet.com/jobs' }) === null) {
    pass('jobstreet.detect() returns null — explicit provider only, no URL auto-detection');
  } else {
    fail('jobstreet.detect() should return null for any URL');
  }

  // parseJobstreetItem — valid item (v5 API shape)
  const sampleItem = {
    id: '92996157',
    title: 'Facility Engineer',
    advertiser: { id: '60960115', description: 'PT YOFC International Indonesia' },
    companyName: 'YOFC International',
    locations: [{ label: 'Karawang, West Java', countryCode: 'ID' }],
    listingDate: '2026-06-29T02:53:00Z',
  };
  const parsed = parseJobstreetItem(sampleItem, 'https://id.jobstreet.com', 'FallbackCo');
  if (parsed && parsed.title === 'Facility Engineer'
      && parsed.url === 'https://id.jobstreet.com/job/92996157'
      && parsed.company === 'PT YOFC International Indonesia'
      && parsed.location === 'Karawang, West Java'
      && parsed.postedAt != null) {
    pass('parseJobstreetItem extracts title, url, company, location, postedAt correctly');
  } else {
    fail(`parseJobstreetItem returned ${JSON.stringify(parsed)}`);
  }

  // parseJobstreetItem — uses companyName fallback when advertiser.description is absent
  const noAdvertiserItem = {
    id: '2',
    title: 'Data Scientist',
    companyName: 'TechCorp',
    locations: [{ label: 'Jakarta' }],
    listingDate: '2026-06-01T00:00:00Z',
  };
  const noAdvParsed = parseJobstreetItem(noAdvertiserItem, 'https://id.jobstreet.com', 'Fallback');
  if (noAdvParsed && noAdvParsed.company === 'TechCorp') {
    pass('parseJobstreetItem falls back to companyName when advertiser.description is absent');
  } else {
    fail(`parseJobstreetItem companyName fallback: ${JSON.stringify(noAdvParsed)}`);
  }

  // parseJobstreetItem — rejects items without title
  if (parseJobstreetItem({ id: '1' }, 'https://id.jobstreet.com', 'Co') === null) {
    pass('parseJobstreetItem returns null for items without title');
  } else {
    fail('parseJobstreetItem should return null for title-less items');
  }

  // parseJobstreetItem — rejects items without id (URL cannot be built)
  if (parseJobstreetItem({ title: 'Role' }, 'https://id.jobstreet.com', 'Co') === null) {
    pass('parseJobstreetItem returns null for items without id');
  } else {
    fail('parseJobstreetItem should return null for items without id');
  }

  // parseJobstreetItem — rejects off-domain base URLs
  const offDomain = parseJobstreetItem(
    { id: '1', title: 'Role', locations: [{ label: 'Remote' }] },
    'https://evil.example.com', 'Co'
  );
  if (offDomain === null) pass('parseJobstreetItem rejects off-domain base URLs');
  else fail(`parseJobstreetItem should reject off-domain base URLs, got ${JSON.stringify(offDomain)}`);

  // parseJobstreetItem — handles null/malformed input safely
  if (parseJobstreetItem(null, 'https://id.jobstreet.com', 'Co') === null) pass('parseJobstreetItem(null) → null');
  else fail('parseJobstreetItem(null) should return null');
  if (parseJobstreetItem(7, 'https://id.jobstreet.com', 'Co') === null) pass('parseJobstreetItem(7) → null');
  else fail('parseJobstreetItem(number) should return null');

  // parseJobstreetItem — uses fallback company when both advertiser and companyName are missing
  const noCompany = parseJobstreetItem(
    { id: '99', title: 'Engineer', locations: [{ label: 'Remote' }] },
    'https://id.jobstreet.com', 'PortalFallback'
  );
  if (noCompany && noCompany.company === 'PortalFallback') {
    pass('parseJobstreetItem uses fallback company when all company fields are missing');
  } else {
    fail(`parseJobstreetItem fallback company: ${JSON.stringify(noCompany)}`);
  }

  // parseJobstreetItem — handles empty locations gracefully
  const noLocItem = {
    id: '42',
    title: 'Remote Engineer',
    advertiser: { description: 'RemoteCo' },
    listingDate: '2026-06-15T00:00:00Z',
  };
  const noLocParsed = parseJobstreetItem(noLocItem, 'https://id.jobstreet.com', 'Fallback');
  if (noLocParsed && noLocParsed.location === '') {
    pass('parseJobstreetItem handles missing locations gracefully');
  } else {
    fail(`parseJobstreetItem empty location: ${JSON.stringify(noLocParsed)}`);
  }

  // fetch() — happy path with mock context (v5 API response shape)
  const mockCtx = {
    transport: 'http',
    fetchJson: async (url) => {
      if (!url.startsWith('https://id.jobstreet.com/api/jobsearch/v5/search')) throw new Error('Unexpected URL');
      return {
        data: [
          {
            id: '92884969',
            title: 'AI Engineer',
            advertiser: { id: '14025083', description: 'Capgemini' },
            companyName: 'Capgemini',
            locations: [{ label: 'Jakarta, Indonesia', countryCode: 'ID' }],
            listingDate: '2026-06-23T03:55:20Z',
          },
        ],
        totalCount: 1,
      };
    },
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const jobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'AI' },
    mockCtx,
  );
  if (jobs.length === 1 && jobs[0].title === 'AI Engineer') pass('jobstreet.fetch() returns parsed jobs via v5 API');
  else fail(`jobstreet.fetch() returned ${JSON.stringify(jobs)}`);

  // fetch() — handles empty results
  const emptyCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: [], totalCount: 0 }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const emptyJobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'nonexistent' },
    emptyCtx,
  );
  if (emptyJobs.length === 0) pass('jobstreet.fetch() handles empty results');
  else fail(`jobstreet.fetch() should return empty array for no results, got ${emptyJobs.length}`);

  // fetch() — rejects invalid hostname
  let hostRejected = false;
  try {
    await jobstreet.fetch(
      { name: 'Bad', provider: 'jobstreet', api: 'https://evil.example.com/api/jobsearch/v5/search' },
      { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('untrusted hostname')) hostRejected = true;
    else fail(`jobstreet.fetch() host rejection wrong error: ${e.message}`);
  }
  if (hostRejected) pass('jobstreet.fetch() rejects untrusted hostnames');
  else fail('jobstreet.fetch() should reject non-jobstreet hostnames');

  // fetch() — accepts SEEK's Hong Kong host (JobsDB brand, same v5 API)
  let hkReached = false;
  const hkJobs = await jobstreet.fetch(
    {
      name: 'JobsDB HK',
      provider: 'jobstreet',
      api: 'https://hk.jobsdb.com/api/jobsearch/v5/search',
      siteKey: 'HK-Main',
      searchKeywords: 'business intelligence',
    },
    {
      transport: 'http',
      fetchJson: async (url) => {
        hkReached = String(url).startsWith('https://hk.jobsdb.com/');
        return { data: [], totalCount: 0 };
      },
      fetchText: async () => { throw new Error('should not be called'); },
    },
  );
  if (hkReached && hkJobs.length === 0) pass('jobstreet.fetch() accepts hk.jobsdb.com (HK-Main)');
  else fail('jobstreet.fetch() should accept hk.jobsdb.com and query it directly');

  // fetch() — handles non-array data field
  const badDataCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: null }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const badDataJobs = await jobstreet.fetch(
    { name: 'Jobstreet ID', provider: 'jobstreet', searchKeywords: 'test' },
    badDataCtx,
  );
  if (badDataJobs.length === 0) pass('jobstreet.fetch() handles null data field');
  else fail(`jobstreet.fetch() should return empty for null data`);

  // parseJobstreetSalary — salaryLabel is a display string; career-ops stores
  // salary ANNUALIZED, and a hidden/ambiguous figure must be null, never zero.
  const { parseJobstreetSalary } = jobstreetModule;
  const SG = 'https://sg.jobstreet.com';
  const salaryCases = [
    ['$3,500 – $4,000 per month', SG, { min: 42000, max: 48000, currency: 'SGD' }],
    ['$6,000 per month', SG, { min: 72000, max: 72000, currency: 'SGD' }],
    ['$35 – $45 per hour', SG, { min: 72800, max: 93600, currency: 'SGD' }],
    ['$90,000 – $120,000 per annum', SG, { min: 90000, max: 120000, currency: 'SGD' }],
    ['', SG, null],
    [undefined, SG, null],
    ['$3,500 – $4,000 per fortnight', SG, null],       // unrecognized period
    ['$3,500 per month', 'https://jobstreet.com', null], // ambiguous market
    ['$3,500 per month', 'https://my.jobstreet.com', { min: 42000, max: 42000, currency: 'MYR' }],
  ];
  let salaryOk = true;
  for (const [label, origin, want] of salaryCases) {
    const got = parseJobstreetSalary(label, origin);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`parseJobstreetSalary(${JSON.stringify(label)}, ${origin}) → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      salaryOk = false;
    }
  }
  if (salaryOk) pass('parseJobstreetSalary annualizes salaryLabel and returns null when hidden/ambiguous');

  // parseJobstreetItem carries the salary through onto the canonical Job
  const priced = parseJobstreetItem(
    { id: '94400315', title: 'Senior Backend Engineer (.Net)', salaryLabel: '$5,500 – $7,000 per month' },
    SG,
    'QUESS',
  );
  if (priced?.salary?.max === 84000 && priced.salary.currency === 'SGD') {
    pass('parseJobstreetItem populates salary from salaryLabel');
  } else {
    fail(`parseJobstreetItem should set salary from salaryLabel, got ${JSON.stringify(priced?.salary)}`);
  }

  const unpriced = parseJobstreetItem(
    { id: '94451840', title: 'Software Engineer (C#)', salaryLabel: '' },
    SG,
    'Ambition',
  );
  if (unpriced && !('salary' in unpriced)) pass('parseJobstreetItem omits salary when the advertiser hid it');
  else fail(`parseJobstreetItem should omit salary for an empty salaryLabel, got ${JSON.stringify(unpriced?.salary)}`);

} catch (e) {
  fail(`jobstreet provider tests crashed: ${e.message}`);
}

