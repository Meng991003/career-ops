// Optimistic concurrency for whole-file writes. Claude Code edits the same
// files while the UI is open; a save carries the version it loaded, and a
// mismatch means someone else wrote in between.
// ponytail: check-then-write is not atomic — the window is milliseconds on a
// single-user machine; a lock would be needed only with concurrent UI writers.
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function fileVersion(abs) {
  if (!existsSync(abs)) return null;
  return createHash('sha1').update(await readFile(abs)).digest('hex');
}

export async function isStale(abs, expected) {
  if (expected === undefined) return false;
  return (await fileVersion(abs)) !== expected;
}
