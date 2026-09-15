// @ts-check
//
// apply-route.mjs — is a Singapore posting's apply route reachable?
//
// The problem this solves: a Singapore job board ad can be either a NATIVE
// listing (apply inside the board) or a MyCareersFuture mirror (the board's
// "Apply" button hands off to mycareersfuture.gov.sg, which gates submission
// behind Singpass). Singpass needs a Singapore NRIC/FIN, so for a candidate
// without PR or an existing pass the MCF route is a dead channel — the posting
// is real, active and completely unapplicable.
//
// That distinction is invisible in a digest row, which is how a tailored CV and
// cover letter get built for a role that cannot be applied to. On 2026-09-15
// that happened twice in one session (Goldtech report 366, Capgemini 365).
//
// Two signals, very different costs and confidence:
//
//   foundit   EXACT and FREE. The search API already returns `applyUrl` /
//             `redirectUrl` per record; if its host is mycareersfuture.gov.sg
//             the route is gated. No extra request. Set in providers/foundit.mjs.
//
//   jobstreet INFERRED. The SEEK v5 search API carries no apply-method field
//             (checked: advertiser, displayType, displayStyle, employer, and
//             solMetadata are all identical between a native ad and a mirror),
//             there is no public job-detail REST endpoint, and /job/{id}/apply
//             answers 403 to a plain HTTP client. What is left is asking MCF
//             whether the ADVERTISER posts there at all — one cached lookup per
//             company, not per job.
//
// The company-level inference is a heuristic and is labelled as one. A company
// that posts on MCF can still run a native ad, so 'likely-gated' means "check
// the apply button before you spend a tailored CV on this", never "skip it".
// Nothing here ever drops a job: an annotation that removes postings would turn
// an MCF outage into a silently short digest.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MCF_SEARCH = 'https://api.mycareersfuture.gov.sg/v2/jobs';
const CACHE_PATH = resolve(__dirname, 'data/.mcf-company-cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ponytail: flat cap on lookups per run. One request per distinct company, and
// a daily scan mostly hits the cache; raise it only if the digest grows past a
// few dozen companies per section.
const MAX_LOOKUPS = 60;
const LOOKUP_DELAY_MS = 250;

/** Hosts whose postings MCF can possibly mirror. MCF is Singapore-only. */
const SG_HOSTS = new Set(['sg.jobstreet.com', 'www.foundit.sg', 'foundit.sg']);

/**
 * Is this URL a Singapore board posting the check applies to?
 * @param {string} url
 */
export function isSgBoardUrl(url) {
  try {
    return SG_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Classify a foundit record's own apply URL. This is the exact signal: foundit
 * hands us the destination, so no inference and no request is involved.
 *
 * @param {string|undefined|null} applyUrl
 * @returns {'gated'|'open'|'unknown'}
 */
export function classifyApplyUrl(applyUrl) {
  if (!applyUrl || typeof applyUrl !== 'string') return 'unknown';
  let host;
  try {
    host = new URL(applyUrl).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (host === 'mycareersfuture.gov.sg' || host.endsWith('.mycareersfuture.gov.sg')) return 'gated';
  return 'open';
}

/**
 * Normalize an advertiser name to a comparable key. Deliberately blunt: MCF
 * writes names in upper case with the full legal suffix ("GOLDTECH RESOURCES
 * PTE LTD") while the boards use a display name ("Goldtech Resources Pte Ltd"),
 * so case and the entity suffix both have to go.
 *
 * @param {string} name
 */
export function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(pte|ltd|llp|inc|limited|private|sdn|bhd|co|company|group|holdings|singapore|asia|international)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Read the on-disk company cache. A missing or corrupt cache is not an error. */
export function loadCache(path = CACHE_PATH) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Persist the company cache. Failure to write is not worth failing a scan over. */
export function saveCache(cache, path = CACHE_PATH) {
  try {
    writeFileSync(path, JSON.stringify(cache, null, 0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Does this advertiser post on MyCareersFuture?
 *
 * Asks MCF's public search for the company name and looks for the name in the
 * returned postings' own `postedCompany.name` — the free-text search matches
 * description text too, so an unfiltered `total` is not evidence about THIS
 * company.
 *
 * @param {string} company
 * @param {(url: string) => Promise<any>} fetchJson
 * @returns {Promise<boolean|null>} null when the lookup could not be made
 */
export async function companyPostsOnMcf(company, fetchJson) {
  const key = normalizeCompany(company);
  if (!key) return null;
  const url = `${MCF_SEARCH}?search=${encodeURIComponent(company)}&limit=20&page=0`;
  let body;
  try {
    body = await fetchJson(url);
  } catch (err) {
    console.error(`apply-route: MCF lookup failed for ${company} — ${err.message}`);
    return null;
  }
  const results = Array.isArray(body?.results) ? body.results : [];
  return results.some(r => {
    const posted = normalizeCompany(r?.postedCompany?.name || '');
    return posted && (posted === key || posted.includes(key) || key.includes(posted));
  });
}

/**
 * Annotate jobs with `applyRoute`. Four states, kept distinct on purpose — the
 * same reasoning as the digest's repost cell, where collapsing "checked and
 * clean" into "never checked" would make a broken check look like good news:
 *
 *   'gated'        the apply URL itself points at MCF. Exact, foundit only.
 *   'likely-gated' the advertiser posts on MCF. Inferred, verify before tailoring.
 *   'open'         checked, no MCF presence found for this advertiser.
 *   'unknown'      not checked, or the lookup failed.
 *
 * @param {Array<any>} jobs
 * @param {{fetchJson: (url: string) => Promise<any>, cache?: object, max?: number, now?: number}} ctx
 */
export async function annotateApplyRoute(jobs, ctx) {
  const { fetchJson, max = MAX_LOOKUPS, now = Date.now() } = ctx;
  const cache = ctx.cache || loadCache();
  let lookups = 0;

  for (const job of jobs) {
    // An exact signal a provider already resolved always wins over inference.
    if (job.applyRoute === 'gated' || job.applyRoute === 'open') continue;

    if (!isSgBoardUrl(job.url || '')) {
      job.applyRoute = 'unknown';
      continue;
    }

    const key = normalizeCompany(job.company || '');
    if (!key) {
      job.applyRoute = 'unknown';
      continue;
    }

    const hit = cache[key];
    if (hit && typeof hit.onMcf === 'boolean' && now - (hit.checkedAt || 0) < CACHE_TTL_MS) {
      job.applyRoute = hit.onMcf ? 'likely-gated' : 'open';
      continue;
    }

    if (lookups >= max) {
      job.applyRoute = 'unknown';
      continue;
    }

    lookups++;
    const onMcf = await companyPostsOnMcf(job.company, fetchJson);
    if (onMcf === null) {
      job.applyRoute = 'unknown';
    } else {
      cache[key] = { onMcf, checkedAt: now };
      job.applyRoute = onMcf ? 'likely-gated' : 'open';
    }
    if (lookups < max) await new Promise(r => setTimeout(r, LOOKUP_DELAY_MS));
  }

  saveCache(cache);
  return jobs;
}
