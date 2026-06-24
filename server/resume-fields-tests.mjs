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
const labeled = `PROFESSIONAL SUMMARY
Dynamic full stack engineer with broad experience across teams and systems.
CONTACT
Address: Cheras, 14 50400
Phone: +60182504378
Email: www.meng705@gmail.com
SKILLS
Full-stack development
Team collaboration
WAI CHUN MENG
Fullstack Software Engineer`;
const L = extractFields(labeled);
eq(L.email, 'meng705@gmail.com', 'strips spurious www. from email');
eq(L.phone, '+60182504378', 'prefers the labeled Phone: line over an address digit run');
eq(L.name, 'WAI CHUN MENG', 'skips section headers + skill phrases to find the name');

eq(extractFields('').email, '', 'empty input is safe');
eq(extractFields(null).name, '', 'null input is safe');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
