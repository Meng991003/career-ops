import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative, isAbsolute } from 'path';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const USER_LAYER_PREFIXES = [
  'cv.md',
  'config/profile.yml',
  'portals.yml',
  'modes/_profile.md',
  'data/',
  'reports/',
  'output/',
  'interview-prep/',
  'batch/tracker-additions/',
];

const allowed = rel =>
  USER_LAYER_PREFIXES.some(p => p.endsWith('/') ? rel.startsWith(p) : rel === p);

export function resolveUserPath(relPath) {
  const abs = join(REPO_ROOT, relPath);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`write blocked: ${relPath}`);
  }
  // Normalize to forward slashes for prefix matching on all platforms.
  const norm = rel.split('\\').join('/');
  if (!allowed(norm)) throw new Error(`write blocked: ${relPath}`);
  return abs;
}
