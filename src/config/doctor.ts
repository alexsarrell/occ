import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { getConfigDir } from './store.js';
import { isTouchIdEnabled, hasTouchIdHardware } from '../core/touchid.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'missing' | 'error';
  message: string;
  fix?: string;
}

export function checkOpenConnect(): DoctorCheck {
  try {
    const path = execFileSync('which', ['openconnect'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { name: 'openconnect', status: 'ok', message: `Installed at ${path}` };
  } catch {
    return {
      name: 'openconnect',
      status: 'missing',
      message: 'Not found in PATH',
      fix: 'brew install openconnect',
    };
  }
}

export async function checkNodePty(): Promise<DoctorCheck> {
  try {
    await import('node-pty');
    return { name: 'node-pty', status: 'ok', message: 'Native module loaded' };
  } catch {
    return {
      name: 'node-pty',
      status: 'error',
      message: 'Native module failed to load',
      fix: 'xcode-select --install && npm rebuild node-pty',
    };
  }
}

export function checkConfigDir(): DoctorCheck {
  const dir = getConfigDir();
  const parent = dirname(dir);
  try {
    accessSync(parent, constants.W_OK);
    return { name: 'config', status: 'ok', message: `Config directory: ${dir}` };
  } catch {
    return {
      name: 'config',
      status: 'error',
      message: `Cannot write to ${parent}`,
    };
  }
}

/** Informational — an 'ok' result here doesn't block anything; it's a hint. */
export function checkTouchId(): DoctorCheck {
  if (!hasTouchIdHardware()) {
    return { name: 'touchid', status: 'ok', message: 'no Touch ID sensor (not applicable)' };
  }
  if (isTouchIdEnabled()) {
    return { name: 'touchid', status: 'ok', message: 'enabled for sudo' };
  }
  return {
    name: 'touchid',
    status: 'ok',
    message: 'sensor available but not enabled for sudo',
    fix: 'occ touchid enable',
  };
}

export async function runAllChecks(): Promise<DoctorCheck[]> {
  return [
    checkOpenConnect(),
    await checkNodePty(),
    checkConfigDir(),
    checkTouchId(),
  ];
}
