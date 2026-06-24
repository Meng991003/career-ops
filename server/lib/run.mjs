import { execFile } from 'child_process';
import { join } from 'path';
import { REPO_ROOT } from './paths.mjs';

export function runScript(script, args = [], { timeout = 120000 } = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, [join(REPO_ROOT, script), ...args],
      { cwd: REPO_ROOT, timeout, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || (err?.message ?? '') });
      });
  });
}

export async function runScriptJson(script, args = []) {
  const { code, stdout, stderr } = await runScript(script, args);
  if (code !== 0) throw new Error(`${script} exited ${code}: ${stderr}`);
  return JSON.parse(stdout);
}
