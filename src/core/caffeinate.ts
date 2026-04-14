import { spawn, type ChildProcess } from 'node:child_process';

let caffeinateProcess: ChildProcess | null = null;

export function startCaffeinate(): void {
  if (caffeinateProcess) return;
  caffeinateProcess = spawn('caffeinate', ['-is'], {
    stdio: 'ignore',
    detached: true,
  });
  caffeinateProcess.unref();
}

export function stopCaffeinate(): void {
  if (caffeinateProcess) {
    caffeinateProcess.kill();
    caffeinateProcess = null;
  }
}
