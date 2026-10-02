import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { parseDocument } from 'yaml';
import { runScriptJson } from '../lib/run.mjs';
import { resolveUserPath, REPO_ROOT } from '../lib/paths.mjs';
import { readJsonBody, readRawBody, sendJson, atomicWrite } from '../lib/http.mjs';
import { extractText } from '../lib/resume-extract.mjs';
import { extractFields } from '../lib/resume-fields.mjs';
import { parsePreferredLocations } from '../lib/locations.mjs';
import { parseList, formatList, parseProofPoints, formatProofPoints } from '../lib/narrative.mjs';
import { fileVersion, isStale } from '../lib/versioned.mjs';

const PROFILE = 'config/profile.yml';
const PROFILE_EXAMPLE = 'config/profile.example.yml';

// Comment-preserving YAML edit: parse to a Document, set paths, stringify.
// js-yaml's load→dump round trip drops every comment in the user's file.
function yamlDoc(text) {
  const doc = parseDocument(text);
  const set = (path, value) => doc.setIn(path, doc.createNode(value));
  return { doc, set, js: doc.toJS() };
}

// 409 guard shared by the whole-file writers. Returns true when it responded.
async function rejectIfStale(res, relPath, version) {
  const abs = join(REPO_ROOT, relPath);
  if (!(await isStale(abs, version))) return false;
  sendJson(res, 409, { error: 'changed on disk — reload', currentVersion: await fileVersion(abs) });
  return true;
}

// Mirror the preferred-location list into portals.yml's location_filter.allow so
// the zero-token scanner only surfaces jobs in those places. Reads portals.yml,
// sets allow, writes it back. No-op (returns false) when there are no locations
// or portals.yml doesn't exist yet — the profile remains the source of truth and
// postPortals seeds the filter when portals.yml is later created.
async function syncPortalsLocationFilter(locations) {
  const portalsPath = join(REPO_ROOT, 'portals.yml');
  if (!locations.length || !existsSync(portalsPath)) return false;
  const { doc, set, js } = yamlDoc(await readFile(portalsPath, 'utf-8'));
  if (!js || typeof js !== 'object') return false;
  set(['location_filter', 'allow'], locations);
  await atomicWrite(resolveUserPath('portals.yml'), String(doc));
  return true;
}

export async function getStatus(req, res) {
  const status = await runScriptJson('doctor.mjs', ['--json']);
  sendJson(res, 200, status);
}

export async function postCv(req, res) {
  const { markdown, version } = await readJsonBody(req);
  if (!markdown || !markdown.trim()) return sendJson(res, 400, { error: 'markdown required' });
  if (await rejectIfStale(res, 'cv.md', version)) return;
  await atomicWrite(resolveUserPath('cv.md'), markdown);
  sendJson(res, 200, { ok: true });
}

export async function postProfile(req, res) {
  const b = await readJsonBody(req);
  if (await rejectIfStale(res, PROFILE, b.version)) return;
  // Base off the user's EXISTING profile when present so fields the form doesn't
  // cover are preserved; fall back to the example template for a fresh setup.
  const profilePath = join(REPO_ROOT, PROFILE);
  const src = existsSync(profilePath) ? profilePath : join(REPO_ROOT, PROFILE_EXAMPLE);
  const { doc, set, js: profile } = yamlDoc(await readFile(src, 'utf-8'));
  if (!profile || !profile.candidate || !profile.target_roles || !profile.location || !profile.compensation) {
    return sendJson(res, 500, { error: 'profile template is missing or malformed' });
  }
  if (b.full_name !== undefined) set(['candidate', 'full_name'], b.full_name);
  if (b.email !== undefined) set(['candidate', 'email'], b.email);
  if (b.location !== undefined) set(['candidate', 'location'], b.location);
  if (b.phone) set(['candidate', 'phone'], b.phone);
  if (b.linkedin) set(['candidate', 'linkedin'], b.linkedin);
  if (b.github) set(['candidate', 'github'], b.github);
  if (Array.isArray(b.target_roles)) set(['target_roles', 'primary'], b.target_roles);
  if (b.timezone) set(['location', 'timezone'], b.timezone);
  if (b.salary_target) set(['compensation', 'target_range'], b.salary_target);
  if (b.salary_period) set(['compensation', 'period'], b.salary_period);
  if (b.preferred_location) set(['location', 'preferred'], b.preferred_location);
  // Narrative fields are authoritative from the form (sent as raw text every save).
  if (b.headline !== undefined) set(['narrative', 'headline'], b.headline);
  if (b.exit_story !== undefined) set(['narrative', 'exit_story'], b.exit_story);
  if (b.superpowers !== undefined) set(['narrative', 'superpowers'], parseList(b.superpowers));
  if (b.proof_points !== undefined) set(['narrative', 'proof_points'], parseProofPoints(b.proof_points));
  await atomicWrite(resolveUserPath(PROFILE), String(doc));
  // Keep the scanner's location filter in step with the stated preference.
  await syncPortalsLocationFilter(parsePreferredLocations(b.preferred_location));
  sendJson(res, 200, { ok: true });
}

// Read current saved onboarding data, flattened into form-ready field values
// (empty strings when nothing is saved yet). Drives prefill of the Setup form.
export async function getData(req, res) {
  const read = p => (existsSync(join(REPO_ROOT, p)) ? readFile(join(REPO_ROOT, p), 'utf-8') : null);
  const profileRaw = await read(PROFILE);
  const cvRaw = await read('cv.md');
  const portalsRaw = await read('portals.yml');
  const p = profileRaw ? (yaml.load(profileRaw) || {}) : {};
  const cand = p.candidate || {}, loc = p.location || {}, comp = p.compensation || {};
  const tr = p.target_roles || {}, nar = p.narrative || {};
  const portals = portalsRaw ? (yaml.load(portalsRaw) || {}) : {};
  const keywords = portals.title_filter?.positive;
  sendJson(res, 200, {
    cv: cvRaw || '',
    full_name: cand.full_name || '', email: cand.email || '', phone: cand.phone || '',
    linkedin: cand.linkedin || '', github: cand.github || '', location: cand.location || '',
    preferred_location: loc.preferred || '', timezone: loc.timezone || '',
    target_roles: Array.isArray(tr.primary) ? tr.primary.join(', ') : '',
    salary_target: comp.target_range || '', salary_period: comp.period || 'monthly',
    headline: nar.headline || '', exit_story: nar.exit_story || '',
    superpowers: formatList(nar.superpowers), proof_points: formatProofPoints(nar.proof_points),
    keywords: Array.isArray(keywords) ? keywords.join(', ') : '',
    versions: {
      cv: await fileVersion(join(REPO_ROOT, 'cv.md')),
      profile: await fileVersion(join(REPO_ROOT, PROFILE)),
      portals: await fileVersion(join(REPO_ROOT, 'portals.yml')),
    },
  });
}

export async function postPortals(req, res) {
  const b = await readJsonBody(req);
  if (await rejectIfStale(res, 'portals.yml', b.version)) return;
  // Base off the user's EXISTING portals.yml — rebuilding from the example
  // template on every save dropped their tracked_companies and filters.
  const portalsPath = join(REPO_ROOT, 'portals.yml');
  const src = existsSync(portalsPath) ? portalsPath : join(REPO_ROOT, 'templates/portals.example.yml');
  const { doc, set, js } = yamlDoc(await readFile(src, 'utf-8'));
  if (!js || typeof js !== 'object') {
    return sendJson(res, 500, { error: 'portals.yml is missing or malformed' });
  }
  if (Array.isArray(b.positiveKeywords) && b.positiveKeywords.length) {
    set(['title_filter', 'positive'], b.positiveKeywords);
  }
  // Seed the location filter from the user's saved preferred location, so a
  // Save Portals after Save Profile still applies it (and vice-versa).
  const profilePath = join(REPO_ROOT, 'config/profile.yml');
  if (existsSync(profilePath)) {
    const prof = yaml.load(await readFile(profilePath, 'utf-8'));
    const locs = parsePreferredLocations(prof?.location?.preferred);
    if (locs.length) set(['location_filter', 'allow'], locs);
  }
  await atomicWrite(resolveUserPath('portals.yml'), String(doc));
  sendJson(res, 200, { ok: true });
}

export async function postCvUpload(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const filename = url.searchParams.get('filename') || '';
  const buffer = await readRawBody(req);
  let text;
  try {
    text = await extractText(buffer, filename);
  } catch (e) {
    if (e.code === 'UNSUPPORTED_FORMAT') return sendJson(res, 400, { error: 'Unsupported file — upload a PDF or .docx' });
    if (e.code === 'EMPTY_EXTRACTION') return sendJson(res, 400, { error: "Couldn't read text — the file may be image-only; paste your CV instead." });
    throw e; // dispatcher → 500
  }
  await atomicWrite(resolveUserPath('cv.md'), text);
  sendJson(res, 200, { ok: true, cvText: text, fields: extractFields(text) });
}
