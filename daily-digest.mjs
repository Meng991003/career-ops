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

// Fix round 4 (C2): the tracker has NO URL column — its schema is
// # | Date | Company | Role | Score | Status | PDF | Report | Notes
// (merge-tracker.mjs:430 LEGACY_COLMAP, AGENTS.md:119). A row's only link is a
// relative markdown report link, so scraping http(s) URLs out of the whole file
// always yielded an empty set and the digest's applied-exclusion was a
// permanent no-op. The applied URL now lives in the Notes cell, written there
// by the daily-jobs playbook when it flips a row to Applied.
//
// Rows are therefore read PER ROW, and only rows whose status means the
// candidate actually submitted contribute URLs — a URL sitting in the Notes of
// an `Evaluated` row must not make an evaluated-but-not-applied role vanish
// from the digest.

// Canonical statuses per templates/states.yml / normalize-statuses.mjs:
// Evaluated · Applied · Responded · Interview · Offer · Rejected · Discarded · SKIP.
// Everything from Applied onward implies a submitted application; Evaluated,
// Discarded and SKIP are all pre-application states.
const APPLIED_STATUSES = new Set(['applied', 'responded', 'interview', 'offer', 'rejected']);

// Header name → logical column, mirroring merge-tracker.mjs's HEADER_ALIASES so
// a customized layout (e.g. an extra Location column after Role) is read by
// header NAME rather than a fixed index.
const TRACKER_HEADERS = {
  '#': 'num', 'num': 'num', 'date': 'date', 'company': 'company', 'empresa': 'company',
  'role': 'role', 'puesto': 'role', 'status': 'status', 'notes': 'notes',
};

// Fallback when no recognizable header row exists — the documented default
// layout, same indices as merge-tracker.mjs's LEGACY_COLMAP (index 0 is the
// empty cell before the first pipe).
const LEGACY_TRACKER_COLS = { num: 1, date: 2, company: 3, role: 4, status: 6, notes: 9 };

/**
 * Locate the tracker's columns from its header row. Returns null (caller keeps
 * the legacy layout) unless company, role and status are all present, so a
 * stray pipe line cannot yield a bogus mapping.
 * @param {string[]} lines
 */
function detectTrackerCols(lines) {
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(s => s.trim().toLowerCase());
    if (!cells.includes('company') || !cells.includes('role')) continue;
    const map = {};
    cells.forEach((c, i) => { if (TRACKER_HEADERS[c] != null) map[TRACKER_HEADERS[c]] = i; });
    if (['company', 'role', 'status'].every(k => map[k] != null)) return map;
  }
  return null;
}

/**
 * Rows of the application tracker the candidate has actually applied to.
 * @param {string} text — contents of data/applications.md
 * @returns {Array<{date: string, company: string, role: string, status: string, urls: string[], notes: string}>}
 */
export function parseAppliedRows(text) {
  const rows = [];
  if (typeof text !== 'string' || !text) return rows;

  const lines = text.split('\n');
  const cols = detectTrackerCols(lines) || LEGACY_TRACKER_COLS;

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue; // separator row
    const parts = line.split('|').map(s => s.trim());
    const status = String(parts[cols.status] || '').replace(/\*\*/g, '').trim().toLowerCase();
    if (!APPLIED_STATUSES.has(status)) continue; // also skips the header row
    rows.push({
      date: parts[cols.date] || '',
      company: parts[cols.company] || '',
      role: parts[cols.role] || '',
      status,
      urls: [...line.matchAll(/https?:\/\/[^\s|)\]]+/g)].map(m => m[0].trim()),
      notes: parts[cols.notes] || '',
    });
  }
  return rows;
}

/**
 * URLs from tracker rows the candidate has applied to. Rows in a pre-application
 * status (Evaluated, Discarded, SKIP) never contribute.
 * @param {string} text
 * @returns {Set<string>}
 */
export function parseAppliedUrls(text) {
  const urls = new Set();
  for (const row of parseAppliedRows(text)) for (const u of row.urls) urls.add(u);
  return urls;
}

/**
 * The date a row's application was actually submitted. The tracker's Date
 * column is written by the evaluation (modes/oferta.md) and preserved
 * byte-for-byte afterward, so it holds the EVALUATION date, not the
 * submission date. Step 7 of the daily-jobs playbook writes the real
 * submission date into the Notes cell (e.g. "Applied 2026-08-21. https://..."),
 * so prefer a YYYY-MM-DD parsed out of Notes, falling back to the Date column
 * when Notes carries no date.
 * @param {{date: string, notes?: string}} row
 * @returns {string}
 */
function submittedDate(row) {
  const m = String(row?.notes || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : row.date;
}

/**
 * Applications submitted on `date`, shaped for renderDigest's applied section.
 * A row with no URL in its Notes cell cannot be linked, so it is skipped.
 * @param {Array<{date: string, company: string, role: string, urls: string[], notes?: string}>} rows
 * @param {string} date — YYYY-MM-DD, from digestDate (candidate's timezone)
 * @returns {Array<{company: string, title: string, url: string}>}
 */
export function pickAppliedToday(rows, date) {
  return (rows || [])
    .filter(r => submittedDate(r) === date && r.urls.length > 0)
    .map(r => ({ company: r.company, title: r.role, url: r.urls[0] }));
}

// ── Triage scoring ─────────────────────────────────────────────────

// Fit round 1: fix round 1. bestOverlap on raw "software"/"engineer" tokens
// saturated at 1.0 for ~389/470 real pipeline titles (any title containing
// both words), making the digest a near-tie coin flip. Splitting the title
// term into role-shape + concrete skill-match + foreign-stack penalty gives
// the candidate's actual stack (C#/.NET, TypeScript, NestJS, ...) a say.

const FIT_WEIGHT = { primary: 1, secondary: 0.7, stretch: 0.3 };

// Generic role-altitude words that would otherwise pollute the skill
// vocabulary (they already drive the role-shape term above).
const SKILL_GENERIC = new Set([
  'software', 'engineer', 'developer', 'senior', 'junior', 'mid', 'lead',
  'full', 'stack', 'backend', 'frontend', 'and', 'with', 'the',
]);

// ponytail: hand-maintained list of stacks the candidate has no experience
// with, per the resume. There's no cheap way to derive "unfamiliar tech" —
// extend/trim this list as false positives/negatives turn up in real digests.
// "swift" was removed: in SG fintech listings it's overwhelmingly the SWIFT
// interbank network ("SWIFT Payments"), not the Apple language — too noisy
// a signal to keep as a plain word match.
const FOREIGN_STACK = [
  'c++', 'embedded', 'firmware', 'verilog', 'vhdl', 'fpga', 'rtos', 'photonic',
  'dsp', 'cobol', 'mainframe', 'abap', 'salesforce', 'sap', 'oracle forms',
  'delphi', 'perl', 'matlab', 'labview', 'plc', 'scada', 'android native',
  'objective-c', 'unity', 'unreal', 'solidity',
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Fix round 2: a raw substring test (`title.includes(tok)`) hit "unity"
// inside "opportunity"/"community"/"immunity" and "delphi" inside
// "Philadelphia". Word-boundary lookarounds fix this while still matching
// multi-word/symbol-bearing tokens like "c++" and "objective-c" correctly —
// a plain `\b` does not, since `+` and `-` aren't word characters.
//
// Fix round 3: the trailing lookahead also rejected a plural "s" ("Silicon
// Photonics Engineer", "Mainframes Support Engineer" escaped the penalty
// entirely). An optional `s?` before the boundary check covers every regular
// plural in the list (photonics, mainframes, FPGAs, DSPs, PLCs) without
// weakening the leading lookbehind that blocks the round-2 false positives —
// that lookbehind checks the character BEFORE the token, which this change
// does not touch.
const FOREIGN_STACK_PATTERNS = FOREIGN_STACK.map(
  tok => new RegExp(`(?<![a-z0-9])${escapeRegex(tok)}s?(?![a-z0-9])`)
);

// Minimum skill-token length. Fix round 4 (I3): tokenizing the real
// config/profile.yml yields two-character fragments ("as", "on", "ci", "cd")
// that carry no stack signal at all.
//
// Fix round 5: this floor also discarded "c#" and "s3" — real tokens, and in
// c#'s case the candidate's FIRST core skill. Scoped to letters-only tokens
// below (see the filter in skillTokens) so a short token containing a digit
// or symbol survives, while "as"/"on"/"ci"/"cd" still get dropped.
const SKILL_MIN_LEN = 3;

/**
 * Candidate's concrete technology vocabulary, tokenized from profile.yml
 * (archetype names + narrative.superpowers), lowercased, generic words
 * dropped. Internal dots (e.g. "node.js") also add the bare prefix ("node")
 * so a title like "NodeJS" (no dot) still matches.
 * @param {any} profile
 * @returns {Set<string>}
 */
export function skillTokens(profile) {
  // Only primary/secondary archetypes: "stretch" fit means the resume shows
  // no evidence of that skill (see config/profile.yml's own comments), so its
  // name must not seed the candidate's real vocabulary — e.g. a lone "ai"
  // token from a stretch "AI Engineer" archetype would otherwise let that
  // archetype's own title self-match as a skill hit.
  const sources = [
    ...(profile?.target_roles?.archetypes || [])
      .filter(a => a?.fit === 'primary' || a?.fit === 'secondary')
      .map(a => a?.name || ''),
    ...(profile?.narrative?.superpowers || []),
  ];
  const tokens = new Set();
  for (const src of sources) {
    for (const raw of String(src).toLowerCase().split(/[\s/+(),;-]+/)) {
      const w = raw.trim();
      if (!w || SKILL_GENERIC.has(w) || (w.length < SKILL_MIN_LEN && /^[a-z]+$/.test(w))) continue;
      tokens.add(w);
      const dot = w.indexOf('.', 1); // internal dot, not a leading one like ".net"
      if (dot > 0 && dot >= SKILL_MIN_LEN) tokens.add(w.slice(0, dot));
    }
  }
  return tokens;
}

/**
 * Skill tokens as WORD-BOUNDARY patterns.
 *
 * Fix round 4 (I3): `scoreJob` matched with raw `lowerTitle.includes(tok)`, so
 * fragments defeated SKILL_GENERIC — "back" and "end" both fire inside the
 * single word "backend", which SKILL_GENERIC explicitly excludes, and the skill
 * term saturates at 3 hits, so any "Backend … Engineer" title collected the
 * full 40 points regardless of stack. Measured on the real pipeline: 27 of 481
 * titles reached full skill marks on junk tokens alone before this change, 0
 * after. This reuses the same escape +
 * lookaround construction as FOREIGN_STACK_PATTERNS, for the same reason: a
 * plain `\b` cannot handle symbol-bearing tokens like ".net" or "c#".
 *
 * The optional `(?:\.?js)?` suffix is deliberate, not incidental: the original
 * design requires `.net` to match inside "C#.Net" (it does — the character
 * before the dot is "#", not alphanumeric) and `node` to match inside "NodeJS",
 * which a pure boundary rule would reject. Allowing the JS suffix keeps
 * "NodeJS"/"Node.js"/"VueJS" matching without reintroducing substring matching.
 * @param {any} profile
 * @returns {RegExp[]}
 */
function skillPatterns(profile) {
  return [...skillTokens(profile)].map(
    tok => new RegExp(`(?<![a-z0-9])${escapeRegex(tok)}(?:\\.?js)?(?![a-z0-9])`)
  );
}

/**
 * Score a job for triage ordering, 0-100. NOT the A-F fit score.
 *
 * Four signals: role-shape overlap with target roles/archetypes (weighted by
 * fit), concrete skill-vocabulary overlap, a foreign-stack penalty, and the
 * unchanged salary + recency terms.
 *
 * @param {any} job
 * @param {any} profile — parsed config/profile.yml
 * @param {number} now — epoch ms, injected for deterministic tests
 * @returns {number}
 */
export function scoreJob(job, profile, now = Date.now()) {
  const title = String(job?.title || '');
  const lowerTitle = title.toLowerCase();
  const titleTokens = new Set(roleTokens(title));

  // 1. Role-shape (max 25): overlap with target roles, weighted by archetype
  // fit so a stretch archetype (e.g. "AI Engineer") can't score like a core one.
  const targets = [
    ...(profile?.target_roles?.primary || []).map(name => ({ name, weight: 1 })),
    ...(profile?.target_roles?.archetypes || [])
      .map(a => ({ name: a?.name || '', weight: FIT_WEIGHT[a?.fit] ?? 0 })),
  ];
  let bestWeightedOverlap = 0;
  for (const { name, weight } of targets) {
    if (weight === 0) continue;
    const wanted = roleTokens(String(name));
    if (wanted.length === 0) continue;
    const hits = wanted.filter(t => titleTokens.has(t)).length;
    bestWeightedOverlap = Math.max(bestWeightedOverlap, (hits / wanted.length) * weight);
  }
  const roleShapeScore = bestWeightedOverlap * 25;

  // 2. Skill match (max 40): this is what actually breaks the tie between
  // same-shaped titles, e.g. "Software Engineer (C/C++)" vs "...C#.NET".
  let skillHits = 0;
  for (const re of skillPatterns(profile)) {
    if (re.test(lowerTitle)) skillHits++;
  }
  const skillScore = 40 * Math.min(1, skillHits / 3);

  // 3. Foreign-stack penalty (-25): a technology the candidate has none of.
  const foreignPenalty = FOREIGN_STACK_PATTERNS.some(re => re.test(lowerTitle)) ? 25 : 0;

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

  const total = roleShapeScore + skillScore - foreignPenalty + salaryScore + recencyScore;
  return Math.round(Math.min(100, Math.max(0, total)));
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

/**
 * Digest date in the candidate's own timezone (config/profile.yml
 * location.timezone). A 07:00 Asia/Kuala_Lumpur scheduled run is 23:00 UTC
 * the PREVIOUS day, so using the UTC date would stamp every scheduled run
 * with yesterday's date. Falls back to the UTC date if no timezone is set.
 * @param {any} profile
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD
 */
export function digestDate(profile, now = new Date()) {
  const tz = profile?.location?.timezone;
  if (!tz) return now.toISOString().slice(0, 10);
  return now.toLocaleDateString('en-CA', { timeZone: tz });
}

// ── Collection ─────────────────────────────────────────────────────

/**
 * Fetch every enabled portal entry and keep the jobs that clear the filters.
 * Extracted from main() so the composition — applied-exclusion, pipeline
 * intersection, failure collection — is testable with an injected ctx and
 * provider map, without a network call.
 *
 * @param {{
 *   portals: any, ctx: any, pending: Set<string>, applied: Set<string>,
 *   titleOk: (t: any) => boolean, locationOk: (l: any) => boolean,
 *   salaryOk: (s: any) => boolean, providers?: Record<string, any>,
 * }} args
 * @returns {Promise<{jobs: Array<any>, failures: string[]}>}
 */
export async function collectJobs({
  portals, ctx, pending, applied, titleOk, locationOk, salaryOk, providers = PROVIDERS,
}) {
  const failures = [];
  const seen = new Set();
  const jobs = [];

  for (const entry of portals?.tracked_companies || []) {
    if (entry.enabled === false) continue;
    const provider = providers[entry.provider];
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
        jobs.push(job);
      }
    } catch (err) {
      failures.push(`${entry.name} (${entry.provider}): ${err.message}`);
    }
  }

  return { jobs, failures };
}

// ── CLI ────────────────────────────────────────────────────────────

async function main() {
  const profile = yaml.load(readFileSync(PROFILE_PATH, 'utf-8')) || {};
  const portals = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};

  const pending = existsSync(PIPELINE_PATH)
    ? parsePendingUrls(readFileSync(PIPELINE_PATH, 'utf-8')) : new Set();
  // Applied rows serve two purposes: their URLs exclude a job from today's list
  // (C2), and the ones dated today fill the digest's "Applied today" section so
  // the file doubles as the post-application report (spec, Delta 5).
  const appliedRows = existsSync(APPLIED_PATH)
    ? parseAppliedRows(readFileSync(APPLIED_PATH, 'utf-8')) : [];
  const applied = new Set(appliedRows.flatMap(r => r.urls));

  const ctx = makeHttpCtx();
  // Reuse all three of scan.mjs's filters. The pipeline.md intersection in
  // collectJobs already implies them for scanned jobs, but on a first run
  // (empty pipeline) we fall through and show everything — without these, that
  // path would be unfiltered and could surface internships or non-SG roles.
  const salaryOk = buildSalaryFilter(portals.salary_filter);
  const titleOk = buildTitleFilter(portals.title_filter);
  const locationOk = buildLocationFilter(portals.location_filter);

  const { jobs: collected, failures } = await collectJobs({
    portals, ctx, pending, applied, titleOk, locationOk, salaryOk,
  });

  const date = digestDate(profile);
  const html = renderDigest({
    jobs: rankJobs(collected, profile, TOP_N),
    applied: pickAppliedToday(appliedRows, date),
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
