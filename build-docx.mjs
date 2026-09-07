// Render a built cv.html into an ATS-friendly .docx.
//   node build-docx.mjs output/<job>/cv.html output/<job>/cv.docx
//
// Some employers ask for the resume in MS Word (Trust Recruit's posting does).
// Rather than hand-author a second CV that could drift from the PDF, this reads
// the SAME cv.html generate-pdf.mjs renders, so both come from one tailor spec.
//
// ATS-friendly on purpose: no tables, no text boxes, no columns, no headers or
// footers, one linear column of real headings and real bullets. Parsers read
// document order; a two-column layout that looks fine to a human interleaves
// into nonsense. The visual grid in the HTML is deliberately flattened here.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle,
} from 'docx';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: node build-docx.mjs <cv.html> <out.docx>');
  process.exit(1);
}

const html = readFileSync(src, 'utf8')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<head[\s\S]*?<\/head>/g, '');

const clean = (s) => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&middot;/g, '·').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  // stripping <strong> leaves " ," and " ." — but only collapse when the mark
  // really ends a word; ".NET" and "Node.js" legitimately follow a space.
  .replace(/\s+([,.;:)])(?=\s|$)/g, '$1')
  .replace(/\(\s+/g, '(')
  .trim();

const all = (re) => [...html.matchAll(re)].map((m) => clean(m[1])).filter(Boolean);
const one = (re) => all(re)[0] || '';

// Walk the body in document order so sections keep their original sequence.
const TOKEN = /<(h1|div|span|li)([^>]*)>([\s\S]*?)(?=<(?:h1|div|span|li|\/div|\/section)\b)/g;
const nodes = [];
for (const m of html.matchAll(TOKEN)) {
  const cls = (m[2].match(/class="([^"]*)"/) || [])[1] || '';
  const text = clean(m[3]);
  if (text) nodes.push({ tag: m[1], cls, text });
}

const name = one(/<h1[^>]*>([\s\S]*?)<\/h1>/g) || 'Curriculum Vitae';
const contact = all(/<div class="contact-row"[^>]*>([\s\S]*?)<\/div>/g)[0] || '';

const P = (text, o = {}) => new Paragraph({
  children: [new TextRun({ text, bold: o.bold, italics: o.italics, size: o.size ?? 20, font: 'Calibri' })],
  alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 60 },
  bullet: o.bullet ? { level: 0 } : undefined,
});

const H = (text) => new Paragraph({
  children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, font: 'Calibri' })],
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 240, after: 100 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '888888', space: 2 } },
});

const body = [
  new Paragraph({
    children: [new TextRun({ text: name, bold: true, size: 32, font: 'Calibri' })],
    alignment: AlignmentType.CENTER, spacing: { after: 60 },
  }),
  P(contact.replace(/\s*\|\s*/g, '  |  '), { align: AlignmentType.CENTER, size: 18, after: 120 }),
];

let competencies = [];
let meta = [];
let section = '';
const flushMeta = () => { if (meta.length) { body.push(P(meta.join('  ·  '), { size: 18, after: 60 })); meta = []; } };
for (const n of nodes) {
  if (meta.length && !n.cls.includes('job-location')) flushMeta();
  if (n.cls.includes('section-title')) {
    if (competencies.length) { body.push(P(competencies.join('  ·  '), { after: 80 })); competencies = []; }
    section = n.text; body.push(H(n.text)); continue;
  }
  if (n.cls.includes('summary-text')) { body.push(P(n.text, { after: 80 })); continue; }
  if (n.cls.includes('competency-tag')) { competencies.push(n.text); continue; }
  if (n.cls.includes('job-role')) { body.push(P(n.text, { bold: true, before: 140, after: 0 })); continue; }
  if (n.cls.includes('job-company')) { body.push(P(n.text, { italics: true, after: 0 })); continue; }
  if (n.cls.includes('job-period')) { meta = [n.text]; continue; }
  if (n.cls.includes('job-location')) { meta.push(n.text); continue; }
  if (n.cls.includes('skill-category')) { body.push(P(n.text, { bold: true, before: 60, after: 0 })); continue; }
  if (n.cls.includes('skill-item')) { body.push(P(n.text, { after: 40 })); continue; }
  if (n.tag === 'li') { body.push(P(n.text, { bullet: true, after: 40 })); continue; }
  if (n.cls.includes('degree') || n.cls.includes('school') || n.cls.includes('project')) {
    body.push(P(n.text, { after: 40 })); continue;
  }
  if (!n.cls && section && n.tag === 'div' && n.text.length > 25) body.push(P(n.text, { after: 40 }));
}
flushMeta();
if (competencies.length) body.push(P(competencies.join('  ·  '), { after: 80 }));

const doc = new Document({
  creator: name,
  title: `${name} - CV`,
  styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
  sections: [{
    properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
    children: body,
  }],
});

writeFileSync(dest, await Packer.toBuffer(doc));
console.log(`wrote ${dest} (${body.length} paragraphs)`);
