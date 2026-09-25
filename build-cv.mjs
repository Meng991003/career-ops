#!/usr/bin/env node
// build-cv.mjs — assemble a tailored CV HTML from cv.md plus a small tailoring spec.
//
//   node build-cv.mjs <spec.yml> [--out <file.html>]
//   node build-cv.mjs --self-check
//
// cv.md is the fact source: name, contact, job headings, bullets, education.
// The spec carries only the TAILORING: a rewritten summary, competency tags, a
// role-specific skills grouping, and per-job bullet selection. Everything the
// spec omits falls back to cv.md, so an empty spec yields a faithful general CV.
//
// Output is ready for: node generate-pdf.mjs <file.html> <file.pdf> --format=a4
//
// Section order is Summary -> Competencies -> Experience -> Skills -> Education,
// which is what generate-pdf.mjs's validator accepts against cv.md's own order.
// ponytail: string templating, no template engine — the shape is fixed.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const CV = 'cv.md';
const TEMPLATE = 'templates/resume-template.html';

// --- cv.md parsing -----------------------------------------------------------

// "Role — Company, City, State" -> {left, org, loc}. The org/loc split is the
// FIRST comma only: companies don't contain commas here but locations do
// ("Petaling Jaya, Selangor"). Degrees do contain commas, which is why the
// em-dash split has to happen first.
function splitHeading(text) {
  const [left, right = ''] = text.split(' — ');
  const comma = right.indexOf(',');
  return comma === -1
    ? { left: left.trim(), org: right.trim(), loc: '' }
    : { left: left.trim(), org: right.slice(0, comma).trim(), loc: right.slice(comma + 1).trim() };
}

function parseEntries(sectionBody) {
  return sectionBody
    .split(/\n### /)
    .slice(1)
    .map(block => {
      const lines = block.split('\n');
      const { left, org, loc } = splitHeading(lines[0]);
      const period = (block.match(/^\*\*(.+?)\*\*$/m) || [, ''])[1].trim();
      const bullets = lines
        .join('\n')
        .split('\n')
        // Continuation lines of a wrapped bullet start with two spaces.
        .reduce((acc, line) => {
          if (/^- /.test(line)) acc.push(line.slice(2).trim());
          else if (/^ {2}\S/.test(line) && acc.length) acc[acc.length - 1] += ' ' + line.trim();
          return acc;
        }, []);
      return { title: left, org, loc, period, bullets };
    });
}

export function parseCv(text) {
  const name = (text.match(/^# (.+)$/m) || [, ''])[1].trim();
  const sections = {};
  for (const chunk of text.split(/\n## /).slice(1)) {
    const nl = chunk.indexOf('\n');
    sections[chunk.slice(0, nl).trim()] = chunk.slice(nl + 1);
  }

  // The contact line is the last ' · '-delimited line before the first '## '.
  const preamble = text.split(/\n## /)[0].split('\n').map(s => s.trim()).filter(Boolean);
  const contactLine = [...preamble].reverse().find(l => l.includes(' · ')) || '';
  const [location = '', phone = '', email = '', linkedin = ''] =
    contactLine.split(' · ').map(s => s.trim());

  const skills = [];
  for (const m of (sections['Technical Skills'] || '').matchAll(/^\*\*(.+?):\*\*\s*(.+)$/gm)) {
    skills.push({ category: m[1].trim(), value: m[2].trim() });
  }

  return {
    name,
    location,
    phone,
    email,
    linkedin,
    summary: (sections['Professional Summary'] || '').trim().replace(/\s*\n\s*/g, ' '),
    skills,
    experience: parseEntries(sections['Work History'] || ''),
    projects: parseEntries(sections['Projects'] || ''),
    education: parseEntries(sections['Education'] || ''),
  };
}

// --- rendering ---------------------------------------------------------------

// Inline markdown only. Raw HTML and entities in cv.md/spec pass through as
// authored, which is how '&middot;' and '&mdash;' survive.
const md = s => String(s ?? '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const linkedinHref = u =>
  /^https?:/.test(u) ? u : `https://${u.replace(/^(www\.)?/, 'www.')}`;

function renderEntry({ title, org, period, loc, bullets }) {
  return `    <div class="job avoid-break">
      <div class="job-header">
        <div><span class="job-role">${md(title)}</span> <span class="job-company">${md(org)}</span></div>
        <div><span class="job-period">${md(period)}</span> <span class="job-location">${md(loc)}</span></div>
      </div>
      <ul>
${bullets.map(b => `        <li>${md(b)}</li>`).join('\n')}
      </ul>
    </div>`;
}

// Match a spec experience item to a cv.md job. Company substring, case-folded.
function pickJob(cv, ref) {
  const needle = String(ref).toLowerCase();
  const hit = cv.experience.find(
    j => j.org.toLowerCase().includes(needle) || j.title.toLowerCase().includes(needle)
  );
  if (!hit) {
    throw new Error(
      `spec references "${ref}" but cv.md has no matching job. Available: ` +
        cv.experience.map(j => j.org).join(', ')
    );
  }
  return hit;
}

export function buildHtml(cv, spec = {}, templateHtml) {
  const head = templateHtml.slice(0, templateHtml.indexOf('<body>'));

  const experience = (spec.experience
    ? spec.experience.map(item => {
        const base = pickJob(cv, item.company ?? item.role ?? item);
        return {
          ...base,
          title: item.title ?? base.title,
          bullets: item.bullets ?? base.bullets,
        };
      })
    : cv.experience
  ).map(renderEntry);

  // Spec skills is an ordered map {Category: value}; default to cv.md's own.
  const skills = spec.skills
    ? Object.entries(spec.skills).map(([category, value]) => ({ category, value }))
    : cv.skills;

  // flex:0 0 100% forces one skill line per row. Without it the template's
  // wrapping flexbox packs short lines side by side.
  const skillsHtml = skills
    .map(
      s =>
        `      <div class="skill-item" style="flex:0 0 100%"><span class="skill-category">${md(
          s.category
        )}</span> ${md(s.value)}</div>`
    )
    .join('\n');

  const competencies = (spec.competencies || [])
    .map(c => `        <span class="competency-tag">${md(c)}</span>`)
    .join('\n');

  // Projects render AFTER Technical Skills: generate-pdf.mjs compares the order
  // of the sections it recognises (summary, skills, projects, education) against
  // cv.md, and cv.md lists Technical Skills near the top with Projects late.
  // `projects: false` in a spec drops the section for a role where it earns nothing.
  const projectEntries = spec.projects === false ? [] : (cv.projects || []);
  const projectBlock = projectEntries.length
    ? `
  <div class="section">
    <div class="section-title">Projects</div>
${projectEntries.map(renderEntry).join('\n')}
  </div>
`
    : '';

  const competencyBlock = competencies
    ? `
  <div class="section">
    <div class="section-title">Core Competencies</div>
    <div class="competencies-grid">
${competencies}
    </div>
  </div>
`
    : '';

  return `${head}<body>
<div class="page">

  <div class="header avoid-break">
    <h1>${md(cv.name)}</h1>
    <div class="header-gradient"></div>
    <div class="contact-row">
      <span>${cv.phone}</span>
      <span class="separator">|</span>
      <span>${cv.email}</span>
      <span class="separator">|</span>
      <a href="${linkedinHref(cv.linkedin)}">${cv.linkedin}</a>
      <span class="separator">|</span>
      <span>${md(spec.location ?? cv.location)}</span>
    </div>
  </div>

  <div class="section avoid-break">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">${md(spec.summary ?? cv.summary)}</div>
  </div>
${competencyBlock}
  <div class="section">
    <div class="section-title">Professional Experience</div>
${experience.join('\n')}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Technical Skills</div>
    <div class="skills-grid">
${skillsHtml}
    </div>
  </div>
${projectBlock}
  <div class="section avoid-break">
    <div class="section-title">Education</div>
${cv.education.map(renderEntry).join('\n')}
  </div>

</div>
</body>
</html>
`;
}

// --- self-check --------------------------------------------------------------

function selfCheck() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error('SELF-CHECK FAILED: ' + msg);
  };
  const cv = parseCv(readFileSync(CV, 'utf8'));

  assert(cv.name.length > 0, 'name not parsed');
  assert(cv.email.includes('@'), `email not parsed, got "${cv.email}"`);
  assert(/^\+/.test(cv.phone), `phone not parsed, got "${cv.phone}"`);
  assert(cv.experience.length >= 3, `expected >=3 jobs, got ${cv.experience.length}`);
  assert(cv.education.length >= 1, 'no education parsed');
  assert(cv.skills.length >= 3, `expected >=3 skill lines, got ${cv.skills.length}`);

  for (const j of cv.experience) {
    assert(j.org, `job "${j.title}" has no company`);
    assert(j.period, `job "${j.title}" has no period`);
    assert(j.bullets.length > 0, `job "${j.title}" has no bullets`);
    // A wrapped bullet must be rejoined, never truncated mid-sentence.
    assert(!j.bullets.some(b => b.endsWith(' and') || b.endsWith(',')),
      `job "${j.title}" has a bullet that looks truncated: "${j.bullets.find(b => b.endsWith(' and') || b.endsWith(','))}"`);
  }

  // Degrees contain a comma before the em dash; make sure that didn't leak
  // into the institution field.
  assert(!cv.education[0].org.startsWith('Computer Science'),
    `education heading split wrong: org="${cv.education[0].org}"`);

  assert(cv.projects.length >= 1, 'no projects parsed from cv.md');
  for (const pr of cv.projects) {
    assert(pr.title, 'a project has no title');
    assert(pr.bullets.length > 0, `project "${pr.title}" has no bullets`);
  }

  const tpl = readFileSync(TEMPLATE, 'utf8');
  const plain = buildHtml(cv, {}, tpl);
  assert(plain.includes(cv.name), 'name missing from output');
  assert(!plain.includes('Core Competencies'), 'empty spec should omit the competencies section');
  assert(plain.includes('Projects'), 'projects section missing from default render');
  assert(plain.includes('plushinteriordesign.sg'), 'project detail missing');
  assert(plain.indexOf('Technical Skills') < plain.indexOf('Projects'),
    'Technical Skills must render before Projects to match cv.md order');
  assert(plain.indexOf('Projects') < plain.indexOf('Education'),
    'Projects must render before Education');
  const dropped = buildHtml(cv, { projects: false }, tpl);
  assert(!dropped.includes('plushinteriordesign.sg'), 'projects:false should drop the section');
  assert((plain.match(/flex:0 0 100%/g) || []).length === cv.skills.length,
    'skill rows not all forced full-width');

  const order = ['Professional Summary', 'Professional Experience', 'Technical Skills', 'Education']
    .map(t => plain.indexOf(t));
  assert(order.every((v, i) => i === 0 || v > order[i - 1]),
    `section order wrong: ${order.join(',')}`);

  const tailored = buildHtml(
    cv,
    {
      summary: 'Tailored **summary**.',
      competencies: ['SQL tuning'],
      skills: { Core: 'C# &middot; .NET' },
      experience: [{ company: 'Itechoice', bullets: ['One bullet only.'] }],
      // projects off so the <li> count below measures experience + education only
      projects: false,
    },
    tpl
  );
  assert(tailored.includes('<strong>summary</strong>'), 'markdown bold not converted');
  assert(tailored.includes('Core Competencies'), 'competencies section missing when specified');
  assert(tailored.includes('C# &middot; .NET'), 'html entity mangled');
  assert((tailored.match(/<li>/g) || []).length === 2, 'bullet override or education bullet lost');
  assert(!tailored.includes('Hokenso'), 'experience filter did not drop unlisted jobs');

  let threw = false;
  try {
    buildHtml(cv, { experience: [{ company: 'NoSuchCompany' }] }, tpl);
  } catch {
    threw = true;
  }
  assert(threw, 'unknown company in spec should throw, not silently vanish');

  console.log(`self-check OK — ${cv.experience.length} jobs, ${cv.skills.length} skill lines, ${cv.education.length} education entry`);
}

// --- cli ---------------------------------------------------------------------

// Only run the CLI when executed directly. Without this guard, importing
// parseCv/buildHtml (job-profile-sync does exactly that) prints usage and
// exits 1, so the module is unusable as a library.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const args = isMain ? process.argv.slice(2) : null;

if (!isMain) {
  // imported as a library — nothing to do
} else if (args[0] === '--self-check') {
  selfCheck();
} else if (!args[0]) {
  console.error('usage: node build-cv.mjs <spec.yml> [--out <file.html>]');
  console.error('       node build-cv.mjs --self-check');
  process.exit(1);
} else {
  const specPath = args[0];
  const outIdx = args.indexOf('--out');
  const out = outIdx !== -1 ? args[outIdx + 1] : specPath.replace(/\.ya?ml$/, '') + '.html';

  const cv = parseCv(readFileSync(CV, 'utf8'));
  const spec = yaml.load(readFileSync(specPath, 'utf8')) || {};
  writeFileSync(out, buildHtml(cv, spec, readFileSync(TEMPLATE, 'utf8')));
  console.log(`built ${out} from ${specPath}`);
  console.log(`  next: node generate-pdf.mjs ${out} output/<name>.pdf --format=a4`);
}
