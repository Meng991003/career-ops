// server/resume-extract-tests.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const ok = (c, m) => c ? pass(m) : fail(m);

const { extractText } = await import(join(HERE, 'lib/resume-extract.mjs'));

const docx = readFileSync(join(HERE, 'fixtures/sample.docx'));
const pdf = readFileSync(join(HERE, 'fixtures/sample.pdf'));

const docxText = await extractText(docx, 'resume.docx');
ok(docxText.includes('Jane Tester'), 'docx: extracts name text');
ok(docxText.includes('jane@example.com'), 'docx: extracts email text');

const pdfText = await extractText(pdf, 'resume.pdf');
ok(pdfText.includes('Jane Tester'), 'pdf: extracts name text');
ok(pdfText.includes('jane@example.com'), 'pdf: extracts email text');

let code = '';
try { await extractText(Buffer.from('hi'), 'notes.txt'); } catch (e) { code = e.code; }
ok(code === 'UNSUPPORTED_FORMAT', 'unsupported extension throws UNSUPPORTED_FORMAT');

let emptyCode = '';
try { await extractText(readFileSync(join(HERE, 'fixtures/empty.docx')), 'empty.docx'); }
catch (e) { emptyCode = e.code; }
ok(emptyCode === 'EMPTY_EXTRACTION', 'blank document throws EMPTY_EXTRACTION');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
