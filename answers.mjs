// @ts-check
/**
 * answers.mjs — the application Q&A knowledge base.
 *
 * Application forms ask the same questions over and over. This store holds the
 * candidate's answers so known questions fill automatically and a new one is
 * asked exactly once.
 *
 * `data/answers.yml` holds PERSONAL DATA and is gitignored in both .gitignore
 * and .git/info/exclude. The double rule is deliberate: the career-ops updater
 * owns .gitignore and could revert a single entry.
 *
 * Entry shape:
 *   q       — the canonical question text (human-readable label)
 *   match   — list of case-insensitive substrings tested against a form's
 *             question text
 *   scope   — 'universal' (fill automatically) | 'per-job' (draft fresh from
 *             the job report; never auto-filled from a stale answer)
 *   a       — the answer text (required for 'universal', absent for 'per-job')
 *   updated — ISO date the entry was last touched
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';

export const DEFAULT_ANSWERS_PATH = 'data/answers.yml';

const VALID_SCOPES = new Set(['universal', 'per-job']);

/**
 * Validate one entry, throwing with a specific message on the first problem.
 * @param {any} entry
 * @param {number|string} where — index or 'input', for the error message
 */
function validateEntry(entry, where) {
  const at = `answers entry ${where}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${at}: must be a mapping`);
  }
  if (typeof entry.q !== 'string' || !entry.q.trim()) {
    throw new Error(`${at}: \`q\` must be a non-empty string`);
  }
  if (!Array.isArray(entry.match) || entry.match.length === 0) {
    throw new Error(`${at}: \`match\` must be a non-empty list`);
  }
  if (entry.match.some(m => typeof m !== 'string' || !m.trim())) {
    throw new Error(`${at}: every \`match\` token must be a non-empty string`);
  }
  if (!VALID_SCOPES.has(entry.scope)) {
    throw new Error(`${at}: \`scope\` must be 'universal' or 'per-job', got ${JSON.stringify(entry.scope)}`);
  }
  if (entry.scope === 'universal' && (typeof entry.a !== 'string' || !entry.a.trim())) {
    throw new Error(`${at}: a 'universal' entry needs a non-empty \`a\``);
  }
}

/**
 * Load and validate the store.
 *
 * Throws on malformed YAML or an invalid entry — it must NEVER fall back to an
 * empty list. A silent fallback would mean known answers go missing and wrong
 * or blank values get typed into a real job application.
 *
 * @param {string} [path]
 * @returns {Array<{q: string, match: string[], scope: string, a?: string, updated?: string}>}
 */
export function loadAnswers(path = DEFAULT_ANSWERS_PATH) {
  if (!existsSync(path)) return [];

  const raw = readFileSync(path, 'utf-8');
  if (!raw.trim()) return [];

  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`${path}: malformed YAML — ${err.message}`);
  }
  if (parsed == null) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: top level must be a list of entries`);
  }
  parsed.forEach((entry, i) => validateEntry(entry, i));
  return parsed;
}

/**
 * Find the entry whose `match` tokens best fit a form question.
 *
 * The LONGEST matching token wins, so a specific entry
 * ('why do you want to relocate') beats a generic one ('why'). Ties keep the
 * earlier entry.
 *
 * @param {Array<any>} entries
 * @param {string} questionText
 * @returns {{entry: any, index: number, token: string}|null}
 */
export function matchAnswer(entries, questionText) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (typeof questionText !== 'string' || !questionText.trim()) return null;

  const haystack = questionText.toLowerCase();
  let best = null;

  entries.forEach((entry, index) => {
    for (const token of entry.match || []) {
      const needle = String(token).toLowerCase().trim();
      if (!needle || !haystack.includes(needle)) continue;
      if (!best || needle.length > best.token.length) {
        best = { entry, index, token: needle };
      }
    }
  });

  return best;
}

/**
 * Append a validated entry and rewrite the file.
 *
 * Validation happens BEFORE any write, so a bad entry can never corrupt an
 * existing store.
 *
 * @param {any} entry
 * @param {string} [path]
 */
export function appendAnswer(entry, path = DEFAULT_ANSWERS_PATH) {
  validateEntry(entry, 'input');
  const existing = loadAnswers(path);
  existing.push(entry);
  writeFileSync(path, yaml.dump(existing, { lineWidth: 100, noRefs: true }), 'utf-8');
}
