// server/routes/applications.mjs
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseTable, findRowByNum } from '../lib/markdown-table.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';
import { readJsonBody, sendJson } from '../lib/http.mjs';
import { runScript } from '../lib/run.mjs';
import { resolveTrackerPath, getCareerOpsRoot } from '../../path-resolver.mjs';

// set-status.mjs exit codes → HTTP. It owns validation, the tracker lock, the
// atomic write and the status-log.tsv ledger; this route only translates.
const EXIT_HTTP = { 1: 400, 2: 404, 3: 409, 4: 503 };

async function loadTracker() {
  const abs = resolveTrackerPath(getCareerOpsRoot());
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
    if (rel.startsWith('reports/')) {
      const abs = join(REPO_ROOT, rel);
      if (existsSync(abs)) report = await readFile(abs, 'utf-8');
    }
  }
  sendJson(res, 200, { row, report });
}

export async function patch(req, res, [num]) {
  if (!/^\d+$/.test(num)) return sendJson(res, 400, { error: 'row number must be a positive integer' });
  const body = await readJsonBody(req);
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  let status = typeof body.status === 'string' ? body.status.trim() : '';
  if (!status && !note) return sendJson(res, 400, { error: 'status or note required' });
  if (!status) {
    // set-status needs a state with --row; restating the current one is a
    // no-op for status and logs no transition.
    const row = findRowByNum((await loadTracker()).rows, num);
    if (!row) return sendJson(res, 404, { error: `no tracker row #${num}` });
    status = row['Status'];
  }
  const args = ['--row', num, status, '--source', 'web', '--json'];
  if (note) args.push('--note', note);
  const { code, stdout, stderr } = await runScript('set-status.mjs', args);
  let out;
  try { out = JSON.parse(stdout); } catch { out = { error: (stderr || stdout).trim() || 'set-status failed' }; }
  sendJson(res, code === 0 ? 200 : (EXIT_HTTP[code] ?? 500), out);
}
