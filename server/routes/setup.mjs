import { readFile } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import { runScriptJson } from '../lib/run.mjs';
import { resolveUserPath, REPO_ROOT } from '../lib/paths.mjs';
import { readJsonBody, readRawBody, sendJson, atomicWrite } from '../lib/http.mjs';
import { extractText } from '../lib/resume-extract.mjs';
import { extractFields } from '../lib/resume-fields.mjs';

export async function getStatus(req, res) {
  const status = await runScriptJson('doctor.mjs', ['--json']);
  sendJson(res, 200, status);
}

export async function postCv(req, res) {
  const { markdown } = await readJsonBody(req);
  if (!markdown || !markdown.trim()) return sendJson(res, 400, { error: 'markdown required' });
  await atomicWrite(resolveUserPath('cv.md'), markdown);
  sendJson(res, 200, { ok: true });
}

export async function postProfile(req, res) {
  const b = await readJsonBody(req);
  const example = await readFile(join(REPO_ROOT, 'config/profile.example.yml'), 'utf-8');
  const profile = yaml.load(example);
  if (!profile || !profile.candidate || !profile.target_roles || !profile.location || !profile.compensation) {
    return sendJson(res, 500, { error: 'profile.example.yml template is missing or malformed' });
  }
  profile.candidate.full_name = b.full_name ?? profile.candidate.full_name;
  profile.candidate.email = b.email ?? profile.candidate.email;
  profile.candidate.location = b.location ?? profile.candidate.location;
  if (b.phone) profile.candidate.phone = b.phone;
  if (b.linkedin) profile.candidate.linkedin = b.linkedin;
  if (b.github) profile.candidate.github = b.github;
  if (Array.isArray(b.target_roles)) profile.target_roles.primary = b.target_roles;
  if (b.timezone) profile.location.timezone = b.timezone;
  if (b.salary_target) profile.compensation.target_range = b.salary_target;
  await atomicWrite(resolveUserPath('config/profile.yml'), yaml.dump(profile, { lineWidth: 100 }));
  sendJson(res, 200, { ok: true });
}

export async function postPortals(req, res) {
  const b = await readJsonBody(req);
  const example = await readFile(join(REPO_ROOT, 'templates/portals.example.yml'), 'utf-8');
  const portals = yaml.load(example);
  if (!portals || typeof portals !== 'object') {
    return sendJson(res, 500, { error: 'portals.example.yml template is missing or malformed' });
  }
  if (Array.isArray(b.positiveKeywords) && b.positiveKeywords.length) {
    portals.title_filter = portals.title_filter || {};
    portals.title_filter.positive = b.positiveKeywords;
  }
  await atomicWrite(resolveUserPath('portals.yml'), yaml.dump(portals, { lineWidth: 100 }));
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
