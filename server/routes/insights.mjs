// server/routes/insights.mjs
// Read-only aggregations for the Today and Stats screens. Every number comes
// from an existing zero-token script; this file only gathers and trims.
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { sendJson } from '../lib/http.mjs';
import { runScriptJson } from '../lib/run.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';
import { parseTable } from '../lib/markdown-table.mjs';
import { resolveTrackerPath, getCareerOpsRoot } from '../../path-resolver.mjs';
import { followUpsDue, worthApplying, latestDigestName, topDigestJobs } from '../lib/today.mjs';

async function latestDigest() {
  const dir = join(REPO_ROOT, 'output');
  if (!existsSync(dir)) return null;
  const name = latestDigestName(await readdir(dir));
  if (!name) return null;
  try { return JSON.parse(await readFile(join(dir, name), 'utf-8')); } catch { return null; }
}

async function trackerRows() {
  const abs = resolveTrackerPath(getCareerOpsRoot());
  return existsSync(abs) ? parseTable(await readFile(abs, 'utf-8')).rows : [];
}

// A tracker script exits non-zero on a missing/empty tracker (e.g.
// followup-cadence.mjs on zero rows). One script failing shouldn't 500 the
// whole screen — degrade to null and note it in `warnings` instead.
function soft(script, warnings) {
  return runScriptJson(script).catch(() => { warnings.push(script); return null; });
}

export async function today(req, res) {
  const warnings = [];
  const [cadence, latency, stats, fv, rows, digest] = await Promise.all([
    soft('followup-cadence.mjs', warnings),
    soft('rejection-latency.mjs', warnings),
    soft('stats.mjs', warnings),
    soft('funnel-velocity.mjs', warnings),
    trackerRows(),
    latestDigest(),
  ]);
  sendJson(res, 200, {
    followUps: followUpsDue(cadence),
    worthApplying: worthApplying(rows),
    digest: topDigestJobs(digest),
    quietInterviews: latency?.flags ?? [],
    funnel: stats?.funnel ?? null,
    calibration: fv?.calibration ?? null,
    warnings,
  });
}

export async function stats(req, res) {
  const warnings = [];
  const [s, fv] = await Promise.all([soft('stats.mjs', warnings), soft('funnel-velocity.mjs', warnings)]);
  sendJson(res, 200, { stats: s ?? null, velocity: fv ?? null, warnings });
}
