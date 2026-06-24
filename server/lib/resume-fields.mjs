// Pure heuristic extraction of contact fields from resume plain text.
// Real-world resumes are often two-column / label-based; pdf-parse linearizes
// them so contact info sits on "Phone:"/"Email:" lines and the name can appear
// well below section headers. So we prefer labeled values, strip a spurious
// leading "www." from emails, and skip section headers + skill phrases when
// guessing the name. Everything stays best-effort — the user reviews before saving.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d\s().-]{5,}\d/;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s)]+/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s)]+/i;

// Lines that are resume section headers, not names — skipped by the name guesser.
const SECTION_HEADERS = new Set([
  'professional summary', 'summary', 'summary of qualifications', 'profile',
  'objective', 'career objective', 'about', 'about me', 'contact',
  'contact information', 'personal details', 'experience', 'work experience',
  'work history', 'professional experience', 'employment history', 'employment',
  'career history', 'professional background', 'education', 'skills',
  'technical skills', 'key skills', 'professional skills', 'core competencies',
  'expertise', 'areas of expertise', 'technical expertise', 'strengths',
  'projects', 'certifications', 'certification', 'languages', 'references',
  'achievements', 'accomplishments', 'awards', 'qualifications', 'interests',
  'activities', 'publications', 'volunteer experience', 'courses', 'training',
]);

function firstMatch(re, text) { const m = text.match(re); return m ? m[0].trim() : ''; }

// Normalize a candidate email: re-match the strict pattern and drop a leading
// "www." that a preceding website token can glue onto the local part.
function cleanEmail(candidate) {
  const m = String(candidate).match(EMAIL);
  if (!m) return '';
  return m[0].replace(/^www\./i, '').trim();
}

function extractEmail(text) {
  const labeled = text.match(/e-?mail\s*[:\-]?\s*(\S+@\S+)/i);
  if (labeled) { const e = cleanEmail(labeled[1]); if (e) return e; }
  return cleanEmail(text);
}

function validPhone(raw, minDigits) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return (digits.length >= minDigits && digits.length <= 15) ? raw.trim() : '';
}

function extractPhone(text) {
  // Prefer a number on a labeled line (Phone/Tel/Mobile/Cell/HP/Contact). Labeled
  // numbers are trusted down to 6 digits; unlabeled needs 8+ to avoid matching
  // postcodes/dates/IDs (e.g. an address "Cheras, 14 50400").
  const labeled = text.match(
    /(?:phone|tel|telephone|mobile|cell|hp|contact)\s*(?:no\.?|number)?\s*[:\-]?\s*(\+?\d[\d\s().-]{4,}\d)/i);
  if (labeled) { const p = validPhone(labeled[1], 6); if (p) return p; }
  const any = text.match(PHONE);
  return any ? validPhone(any[0], 8) : '';
}

function guessName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Scan a generous window from the top (linearized layouts can push the name
  // down past the contact/skills blocks) and return the first line that looks
  // like a person's name: 2-4 words, each starting uppercase, no digits/@/colon,
  // and not a known section header. Skill phrases like "Full-stack development"
  // fail the per-word-capitalized test (their second word is lowercase).
  for (const line of lines.slice(0, 60)) {
    if (line.includes('@') || line.includes(':') || /\d/.test(line)) continue;
    if (SECTION_HEADERS.has(line.toLowerCase())) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (words.every(w => /^[A-Z][A-Za-z.'-]*$/.test(w))) return line;
  }
  return '';
}

export function extractFields(text) {
  const t = String(text ?? '');
  return {
    email: extractEmail(t),
    phone: extractPhone(t),
    linkedin: firstMatch(LINKEDIN, t),
    github: firstMatch(GITHUB, t),
    name: guessName(t),
  };
}
