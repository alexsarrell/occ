import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let caffeinateProcess: ChildProcess | null = null;

function pidFilePath(): string {
  const dir = process.env.OCC_CONFIG_DIR ?? join(homedir(), '.occ');
  return join(dir, '.caffeinate.pid');
}

export function startCaffeinate(): void {
  if (caffeinateProcess) return;
  // -i: prevent idle system sleep on battery and AC
  // -s: prevent system sleep on AC
  // -d: keep the display awake as well, so a black/locked screen is not
  //     mistaken for sleep while a protected VPN session is active
  caffeinateProcess = spawn('caffeinate', ['-d', '-i', '-s'], {
    stdio: 'ignore',
    detached: true,
  });
  caffeinateProcess.unref();
  try {
    writeFileSync(pidFilePath(), String(caffeinateProcess.pid));
  } catch {
    // best effort
  }
}

export function stopCaffeinate(): void {
  if (caffeinateProcess) {
    caffeinateProcess.kill();
    caffeinateProcess = null;
  }
  cleanupPidFile();
}

/** Kill caffeinate started by another occ process (used by `occ stop`) */
export function stopOrphanedCaffeinate(): void {
  const file = pidFilePath();
  try {
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, 'utf-8').trim());
      if (pid) process.kill(pid, 'SIGTERM');
    }
  } catch {
    // process may already be dead
  }
  cleanupPidFile();
}

function cleanupPidFile(): void {
  try {
    const file = pidFilePath();
    if (existsSync(file)) unlinkSync(file);
  } catch {
    // best effort
  }
}
