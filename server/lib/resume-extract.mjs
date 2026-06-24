// server/lib/resume-extract.mjs
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { extname } from 'path';

export async function extractText(buffer, filename) {
  const ext = extname(String(filename || '').toLowerCase());
  let text;
  if (ext === '.pdf') {
    const data = await pdfParse(buffer);
    text = data.text;
  } else if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    text = value;
  } else {
    const err = new Error(`unsupported format: ${ext || '(none)'}`);
    err.code = 'UNSUPPORTED_FORMAT';
    throw err;
  }
  if (!text || !text.trim()) {
    const err = new Error('no text extracted');
    err.code = 'EMPTY_EXTRACTION';
    throw err;
  }
  return text;
}
