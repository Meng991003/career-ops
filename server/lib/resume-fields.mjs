// Pure heuristic extraction of contact fields from resume plain text.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d\s().-]{5,}\d/;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s)]+/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s)]+/i;

function firstMatch(re, text) { const m = text.match(re); return m ? m[0].trim() : ''; }

function guessName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (line.includes('@') || /\d/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Z][a-zA-Z.'-]*$/.test(w))) {
      return line;
    }
  }
  return '';
}

export function extractFields(text) {
  const t = String(text ?? '');
  let phone = '';
  const pm = t.match(PHONE);
  if (pm) {
    const digits = pm[0].replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) phone = pm[0].trim();
  }
  return {
    email: firstMatch(EMAIL, t),
    phone,
    linkedin: firstMatch(LINKEDIN, t),
    github: firstMatch(GITHUB, t),
    name: guessName(t),
  };
}
