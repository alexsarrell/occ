import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const MARKER_START = '# BEGIN occ-managed — do not edit; use `occ hotkeys` to manage';
const MARKER_END = '# END occ-managed';

export interface Hotkey {
  key: string;
  command: string;
  description: string;
}

export function getSkhdConfigPath(): string {
  return join(homedir(), '.config', 'skhd', 'skhdrc');
}

export function isSkhdInstalled(): boolean {
  try {
    execFileSync('which', ['skhd'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getSkhdPath(): string | null {
  try {
    return execFileSync('which', ['skhd'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function getOccBinaryPath(): string | null {
  try {
    return execFileSync('which', ['occ'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function installSkhdViaBrew(): void {
  // -q is non-interactive, fails fast if something's off
  execFileSync('brew', ['install', 'koekeishiya/formulae/skhd'], { stdio: 'inherit' });
}

export function startSkhdService(): void {
  try {
    execFileSync('skhd', ['--start-service'], { stdio: 'pipe' });
  } catch {
    // already running, ignore
  }
}

export function restartSkhdService(): void {
  try {
    execFileSync('skhd', ['--restart-service'], { stdio: 'pipe' });
  } catch {
    // service might not be installed as launch agent; try start
    try {
      execFileSync('skhd', ['--start-service'], { stdio: 'pipe' });
    } catch {
      // best effort
    }
  }
}

export function ensureConfigExists(): void {
  const path = getSkhdConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(path)) {
    writeFileSync(path, '');
  }
}

function readConfig(): string {
  const path = getSkhdConfigPath();
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

function writeConfig(content: string): void {
  ensureConfigExists();
  writeFileSync(getSkhdConfigPath(), content);
}

/** Parse hotkeys from the managed block (ignores lines that are not hotkey bindings) */
export function getManagedHotkeys(): Hotkey[] {
  const content = readConfig();
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return [];

  const block = content.slice(startIdx + MARKER_START.length, endIdx);
  const lines = block.split('\n');
  const hotkeys: Hotkey[] = [];
  let pendingDescription = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingDescription = '';
      continue;
    }
    if (line.startsWith('#')) {
      pendingDescription = line.replace(/^#\s*/, '');
      continue;
    }
    // Binding: "modifier - key : command"
    const match = line.match(/^(.+?)\s*:\s*(.+)$/);
    if (match) {
      hotkeys.push({
        key: match[1].trim(),
        command: match[2].trim(),
        description: pendingDescription,
      });
      pendingDescription = '';
    }
  }

  return hotkeys;
}

function renderManagedBlock(hotkeys: Hotkey[]): string {
  const lines: string[] = [MARKER_START];
  for (const hk of hotkeys) {
    if (hk.description) {
      lines.push(`# ${hk.description}`);
    }
    lines.push(`${hk.key} : ${hk.command}`);
    lines.push('');
  }
  lines.push(MARKER_END);
  return lines.join('\n');
}

/** Replace or insert the managed block. Leaves user's other bindings intact. */
export function writeManagedHotkeys(hotkeys: Hotkey[]): void {
  const content = readConfig();
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  const block = renderManagedBlock(hotkeys);

  let next: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block
    const before = content.slice(0, startIdx).replace(/\n*$/, '');
    const after = content.slice(endIdx + MARKER_END.length).replace(/^\n*/, '');
    next = [before, block, after].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n');
    if (!next.endsWith('\n')) next += '\n';
  } else {
    // Append to end
    const trimmed = content.replace(/\n*$/, '');
    next = trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
  }

  writeConfig(next);
}

/** Remove the managed block entirely, leave the rest of the config alone. */
export function removeManagedBlock(): boolean {
  const content = readConfig();
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return false;

  const before = content.slice(0, startIdx).replace(/\n*$/, '');
  const after = content.slice(endIdx + MARKER_END.length).replace(/^\n*/, '');
  const next = [before, after].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n');
  writeConfig(next ? (next.endsWith('\n') ? next : next + '\n') : '');
  return true;
}

/** Build the default hotkey set, baking in the resolved path to `occ` for reliability. */
export function buildDefaultHotkeys(occPath: string): Hotkey[] {
  const iterm = (cmd: string) =>
    `osascript -e 'tell application "iTerm" to create window with default profile command "${cmd}"'`;
  // Use Cmd+Ctrl+Option+letter (⌃⌥⌘) — 4-key combos that don't collide with
  // common app/system shortcuts (unlike Cmd+Shift+letter which conflicts
  // with e.g. paste-as-plain-text).
  return [
    {
      key: 'cmd + ctrl + alt - v',
      command: iterm(occPath),
      description: 'Open occ interactive menu',
    },
    {
      key: 'cmd + ctrl + alt - c',
      command: iterm(`${occPath} connect`),
      description: 'Connect to default VPN profile',
    },
    {
      key: 'cmd + ctrl + alt - d',
      command: `${occPath} stop > /dev/null 2>&1 && osascript -e 'display notification "VPN disconnected" with title "occ"'`,
      description: 'Disconnect VPN (with notification)',
    },
  ];
}

/** Open System Settings at Accessibility pane so user can grant permission to skhd. */
export function openAccessibilitySettings(): void {
  try {
    execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
  } catch {
    // best effort
  }
}
