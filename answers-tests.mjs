#!/usr/bin/env node
// @ts-check
/**
 * answers-tests.mjs — unit tests for the application Q&A knowledge base.
 * Run: node answers-tests.mjs
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadAnswers, matchAnswer, appendAnswer } from './answers.mjs';

let passed = 0;
let failed = 0;
function assert(condition, testName) {
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName}`); }
}
function section(name) { console.log(`\n━━━ ${name} ━━━`); }

const dir = mkdtempSync(join(tmpdir(), 'answers-'));
const file = join(dir, 'answers.yml');

const VALID = `- q: What is your notice period?
  match: [notice, availability, start date]
  scope: universal
  a: 2 months
  updated: 2026-08-20

- q: Why do you want to join {company}?
  match: [why, interested, motivat]
  scope: per-job
  updated: 2026-08-20
`;

section('loadAnswers');

writeFileSync(file, VALID, 'utf-8');
const entries = loadAnswers(file);
assert(entries.length === 2, 'loads both entries');
assert(entries[0].scope === 'universal', 'scope preserved');
assert(entries[0].a === '2 months', 'answer text preserved');

writeFileSync(file, '', 'utf-8');
assert(loadAnswers(file).length === 0, 'empty file → empty array');

section('loadAnswers — fails loudly, never silently empty');

writeFileSync(file, 'this: [is: not: valid\n  - yaml', 'utf-8');
let threw = false;
try { loadAnswers(file); } catch { threw = true; }
assert(threw, 'malformed YAML throws (never returns [] silently)');

writeFileSync(file, '- q: missing its match key\n  scope: universal\n', 'utf-8');
threw = false;
try { loadAnswers(file); } catch { threw = true; }
assert(threw, 'entry missing `match` throws');

writeFileSync(file, '- q: bad scope\n  match: [x]\n  scope: sometimes\n', 'utf-8');
threw = false;
try { loadAnswers(file); } catch { threw = true; }
assert(threw, 'invalid scope value throws');

section('matchAnswer');

writeFileSync(file, VALID, 'utf-8');
const loaded = loadAnswers(file);

assert(matchAnswer(loaded, 'What is your notice period?')?.entry.scope === 'universal', 'exact question matches');
assert(matchAnswer(loaded, 'NOTICE PERIOD') !== null, 'match is case-insensitive');
assert(matchAnswer(loaded, 'When is your earliest start date?') !== null, 'matches on a secondary token');
assert(matchAnswer(loaded, 'Why are you interested in this role?')?.entry.scope === 'per-job', 'per-job entry matches');
assert(matchAnswer(loaded, 'What is your favourite colour?') === null, 'unknown question → null');
assert(matchAnswer(loaded, '') === null, 'empty question → null');
assert(matchAnswer([], 'anything') === null, 'empty store → null');

section('matchAnswer — longest token wins');

const ambiguous = [
  { q: 'Generic why', match: ['why'], scope: 'per-job', updated: '2026-08-20' },
  { q: 'Specific relocation', match: ['why do you want to relocate'], scope: 'per-job', updated: '2026-08-20' },
];
assert(
  matchAnswer(ambiguous, 'Why do you want to relocate to Singapore?')?.entry.q === 'Specific relocation',
  'longest matching token wins over a shorter one'
);

section('appendAnswer');

writeFileSync(file, VALID, 'utf-8');
appendAnswer({
  q: 'Do you require visa sponsorship?',
  match: ['visa', 'sponsorship'],
  scope: 'universal',
  a: 'Yes — I would require a Singapore Employment Pass.',
  updated: '2026-08-20',
}, file);

const after = loadAnswers(file);
assert(after.length === 3, 'entry appended');
assert(matchAnswer(after, 'Do you require visa sponsorship?') !== null, 'appended entry is matchable');
assert(after[0].q === 'What is your notice period?', 'existing entries preserved and ordered');
assert(/Employment Pass/.test(readFileSync(file, 'utf-8')), 'answer text written to disk');

appendAnswer({ q: 'x', match: ['zzz'], scope: 'universal', a: 'y', updated: '2026-08-20' }, join(dir, 'new.yml'));
assert(loadAnswers(join(dir, 'new.yml')).length === 1, 'appending to a missing file creates it');

section('appendAnswer — validation');

threw = false;
try { appendAnswer({ q: 'no match key', scope: 'universal', updated: '2026-08-20' }, file); } catch { threw = true; }
assert(threw, 'appending an invalid entry throws');
assert(loadAnswers(file).length === 3, 'failed append did not corrupt the file');

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
