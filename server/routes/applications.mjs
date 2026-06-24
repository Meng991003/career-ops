// server/routes/applications.mjs
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseTable, serializeRows, findRowByNum } from '../lib/markdown-table.mjs';
import { resolveUserPath, REPO_ROOT } from '../lib/paths.mjs';
import { readJsonBody, sendJson, atomicWrite } from '../lib/http.mjs';

const TRACKER = 'data/applications.md';
const CANON = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];

async function loadTracker() {
  const abs = join(REPO_ROOT, TRACKER);
  if (!existsSync(abs)) return { headers: [], rows: [], abs, raw: '' };
  const raw = await readFile(abs, 'utf-8');
  return { ...parseTable(raw), abs, raw };
}

export async function list(req, res) {
  const { rows } = await loadTracker();
  const groups = {};
  for (const r of rows) {
    const s = (r['Status'] || '').trim();
    (groups[s] ||= []).push(r);
  }
  sendJson(res, 200, { rows, groups });
}

export async function getOne(req, res, [num]) {
  const { rows } = await loadTracker();
  const row = findRowByNum(rows, num);
  if (!row) return sendJson(res, 404, { error: 'not found' });
  let report = null;
  const link = (row['Report'] || '').match(/\(([^)]+\.md)\)/);
  if (link) {
    const rel = link[1].replace(/^\.\.\//, '');
    const abs = join(REPO_ROOT, rel);
    if (existsSync(abs)) report = await readFile(abs, 'utf-8');
  }
  sendJson(res, 200, { row, report });
}

export async function patch(req, res, [num]) {
  const body = await readJsonBody(req);
  if (body.status && !CANON.some(c => c.toLowerCase() === String(body.status).toLowerCase())) {
    return sendJson(res, 400, { error: `non-canonical status: ${body.status}` });
  }
  const { headers, rows } = await loadTracker();
  const row = findRowByNum(rows, num);
  if (!row) return sendJson(res, 404, { error: 'not found' });
  if (body.status) row['Status'] = CANON.find(c => c.toLowerCase() === String(body.status).toLowerCase());
  if (body.notes !== undefined) row['Notes'] = String(body.notes).replace(/\n/g, ' ');
  // Preserve the file's preamble (title line) above the table.
  const raw = (await readFile(resolveUserPath(TRACKER), 'utf-8'));
  const preamble = raw.split('\n').filter(l => !l.trim().startsWith('|')).join('\n').trimEnd();
  await atomicWrite(resolveUserPath(TRACKER), `${preamble}\n\n${serializeRows(headers, rows)}`);
  sendJson(res, 200, { ok: true, row });
}
