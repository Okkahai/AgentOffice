import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Verification = actually running the repository's own checks. Discovered, never assumed.

export interface Check { name: string; argv: string[] }
export interface CheckResult extends Check { exitCode: number | null; passed: boolean; durationMs: number; outputTail: string }

const KNOWN_SCRIPTS = ['lint', 'typecheck', 'test', 'build'];

export async function discoverChecks(dir: string): Promise<Check[]> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    return KNOWN_SCRIPTS.filter((s) => pkg.scripts?.[s]).map((s) => ({ name: s, argv: ['npm', 'run', '--silent', s] }));
  } catch {
    return [];
  }
}

export function runCheck(check: Check, cwd: string, timeoutMs = 300_000): Promise<CheckResult> {
  const started = Date.now();
  const [cmd, ...args] = check.argv;
  return new Promise((resolve) => {
    // Windows ships npm as npm.cmd, which execFile cannot start without a shell. argv here is fixed (see KNOWN_SCRIPTS or trusted config), never user input.
    execFile(cmd!, args, { cwd, timeout: timeoutMs, shell: process.platform === 'win32', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, CI: '1' } }, (err, stdout, stderr) => {
      const exitCode = err ? (typeof (err as any).code === 'number' ? (err as any).code : null) : 0;
      const out = `${stdout}${stderr}`;
      resolve({ ...check, exitCode, passed: exitCode === 0, durationMs: Date.now() - started, outputTail: out.slice(-4000) });
    });
  });
}
