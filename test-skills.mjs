#!/usr/bin/env node
// test-skills.mjs — check that what the SKILL.md files tell an agent to run
// actually exists.
//
//   node test-skills.mjs
//
// Skills are written from memory and then trusted. That is how a skill ends up
// telling an agent to run `tracker.mjs add` (no such subcommand),
// `generate-pdf.mjs --report` (not a flag it takes), or to import a module that
// exits on import. Each of those failed silently at the worst moment: mid-task,
// on a real application.
//
// This checks the mechanical claims a skill makes — script exists, path exists,
// named export exists, module is importable — so a wrong one fails here rather
// than in front of an employer. It does NOT execute the commands: many scan
// portals, submit forms or overwrite the tracker.
//
// LIMIT: existence only. `tracker.mjs add` passes because tracker.mjs exists,
// even though `add` is not one of its subcommands. Wrong subcommands and wrong
// flags still need a human to read the script.
// ponytail: regex over markdown, no parser — the surface is small and fixed.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SKILL_ROOTS = ['.claude/skills', '.agents/skills'];

// Paths a skill may name that this repo does not ship — mentioned as examples,
// or created at runtime.
const IGNORE_PATHS = new Set(['payload.json', 'input.html', '<payload>.json']);

function skillFiles() {
  const out = [];
  for (const root of SKILL_ROOTS) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      const f = join(root, dir, 'SKILL.md');
      if (existsSync(f) && statSync(f).isFile()) out.push(f);
    }
  }
  return out;
}

/** Local .mjs scripts a skill tells the agent to run or import. */
function referencedScripts(text) {
  const hits = new Set();
  for (const m of text.matchAll(/\bnode\s+(?:--input-type=module\s+)?([\w./-]+\.mjs)/g)) hits.add(m[1]);
  for (const m of text.matchAll(/from\s+'(\.\/[\w./-]+\.mjs)'/g)) hits.add(m[1]);
  for (const m of text.matchAll(/import\(\s*'(\.\/[\w./-]+\.mjs)'\s*\)/g)) hits.add(m[1]);
  return [...hits].map(p => p.replace(/^\.\//, ''));
}

/** Repo files a skill names as data or config. */
function referencedPaths(text) {
  const hits = new Set();
  const re = /\b((?:config|data|modes|templates|tailor|output|reports)\/[\w./-]+\.(?:md|yml|yaml|json|html|tsv))\b/g;
  for (const m of text.matchAll(re)) hits.add(m[1]);
  for (const m of text.matchAll(/\b(cv\.md|portals\.yml|voice-dna\.md)\b/g)) hits.add(m[1]);
  return [...hits];
}

/** Named imports from local modules: `import { a, b } from './x.mjs'`. */
function referencedExports(text) {
  const out = [];
  const re = /import\s*\{([^}]+)\}\s*from\s*'(\.\/[\w./-]+\.mjs)'/g;
  for (const m of text.matchAll(re)) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    out.push({ module: m[2].replace(/^\.\//, ''), names });
  }
  // `const {a} = await import('./x.mjs')` — the destructured form
  const re2 = /const\s*\{([^}]+)\}\s*=\s*await\s+import\(\s*'(\.\/[\w./-]+\.mjs)'\s*\)/g;
  for (const m of text.matchAll(re2)) {
    const names = m[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
    out.push({ module: m[2].replace(/^\.\//, ''), names });
  }
  return out;
}

const problems = [];
const files = skillFiles();

if (files.length === 0) {
  console.error('no SKILL.md files found — run from the project root');
  process.exit(1);
}

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const label = file.split('/').slice(-2, -1)[0];

  // frontmatter: a skill with no name or description will not surface properly
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) problems.push(`${label}: missing YAML frontmatter`);
  else {
    for (const key of ['name', 'description']) {
      if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(fm[1])) {
        problems.push(`${label}: frontmatter has no ${key}`);
      }
    }
    const declared = (/^name:\s*(.+)$/m.exec(fm[1]) || [, ''])[1].trim();
    if (declared && declared !== label) {
      problems.push(`${label}: frontmatter name "${declared}" does not match its directory`);
    }
  }

  for (const script of referencedScripts(text)) {
    if (!existsSync(script)) problems.push(`${label}: references missing script ${script}`);
  }

  for (const p of referencedPaths(text)) {
    if (IGNORE_PATHS.has(p)) continue;
    // output/ and reports/ are generated; a named example there is not a defect
    if (/^(output|reports)\//.test(p)) continue;
    if (p.includes('<') || p.includes('{')) continue; // placeholder, not a real path
    if (!existsSync(p)) problems.push(`${label}: references missing file ${p}`);
  }

  for (const { module, names } of referencedExports(text)) {
    if (!existsSync(module)) continue; // already reported above
    // Import in a CHILD process. A module that runs its CLI at import time
    // calls process.exit(), which would kill this checker outright — the
    // failure would be visible but unattributed. Isolating it lets us name
    // the culprit instead of dying with its usage message.
    const probe = spawnSync(process.execPath, [
      '--input-type=module', '-e',
      `import('./${module}').then(m=>console.log(JSON.stringify(Object.keys(m))))`,
    ], { encoding: 'utf8', timeout: 15_000 });

    if (probe.status !== 0 || !probe.stdout.trim().startsWith('[')) {
      const why = (probe.stderr || probe.stdout || '').trim().split('\n')[0] || `exit ${probe.status}`;
      problems.push(`${label}: importing ${module} is not side-effect free — ${why}`);
      continue;
    }
    const exported = new Set(JSON.parse(probe.stdout.trim()));
    for (const n of names) {
      if (!exported.has(n)) problems.push(`${label}: ${module} does not export ${n}`);
    }
  }
}

console.log(`checked ${files.length} skills`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('all referenced scripts, paths and exports resolve');
