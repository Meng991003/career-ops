import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const eq = (a, b, m) => a === b ? pass(m) : fail(`${m} :: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const { extractFields } = await import(join(HERE, 'lib/resume-fields.mjs'));

const full = `Jane Tester
jane@example.com
+1 555 0100
linkedin.com/in/janetester
github.com/janetester
Senior Engineer with 10 years experience.`;
const f = extractFields(full);
eq(f.email, 'jane@example.com', 'extracts email');
eq(f.phone, '+1 555 0100', 'extracts phone');
eq(f.linkedin, 'linkedin.com/in/janetester', 'extracts linkedin');
eq(f.github, 'github.com/janetester', 'extracts github');
eq(f.name, 'Jane Tester', 'guesses name from first line');

const sparse = `Contact: a@b.com or c@d.com
No number on this line.`;
const s = extractFields(sparse);
eq(s.email, 'a@b.com', 'picks the first of multiple emails');
eq(s.phone, '', 'no phone → empty');
eq(s.linkedin, '', 'no linkedin → empty');
eq(s.name, '', 'no confident name → empty');

// Two-column / label-based resume linearized by pdf-parse: contact block with
// labels, a section header before the name, skills phrases, then the name.
// Fixtures are synthetic. They used to carry a real candidate's address, phone,
// email and name; this file is tracked and `origin` is a fork of a public repo.
const labeled = `PROFESSIONAL SUMMARY
Dynamic full stack engineer with broad experience across teams and systems.
CONTACT
Address: Someplace, 14 50400
Phone: +60111234567
Email: www.sample123@example.com
SKILLS
Full-stack development
Team collaboration
ALEX SAMPLE
Fullstack Software Engineer`;
const L = extractFields(labeled);
// A leading "www." is part of the local part, not a glued website token: it must
// survive extraction. Stripping it corrupted a real user's address on every run,
// and the glue case it was meant to rescue is unsalvageable anyway (see the
// header note in lib/resume-fields.mjs).
eq(L.email, 'www.sample123@example.com', 'keeps a leading www. in the email local part');
eq(L.phone, '+60111234567', 'prefers the labeled Phone: line over an address digit run');
eq(L.name, 'ALEX SAMPLE', 'skips section headers + skill phrases to find the name');

// The glue shape the old strip targeted. Whatever comes back is wrong either
// way, so the contract is only that it does not throw and does not silently
// hand back a plausible-looking address.
const glued = extractFields('Portfolio www.site.comfoo@bar.com');
eq(glued.email, 'www.site.comfoo@bar.com', 'glued website+email is returned verbatim for the user to correct');

eq(extractFields('').email, '', 'empty input is safe');
eq(extractFields(null).name, '', 'null input is safe');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
