import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SUDO_LOCAL = '/etc/pam.d/sudo_local';
const SUDO_LOCAL_TEMPLATE = '/etc/pam.d/sudo_local.template';

const PAM_TID_LINE = 'auth       sufficient     pam_tid.so';
const OCC_MARKER = '# Added by occ — enables Touch ID for sudo';

/**
 * pam_reattach is required for pam_tid to work inside non-login terminals
 * (iTerm, tmux, subprocess ptys). Without it, the Touch ID overlay appears
 * but sudo doesn't actually accept the auth because of a macOS session
 * context mismatch between the pty and the user's Aqua session.
 *
 * Brew-installed at one of these paths depending on Apple Silicon / Intel.
 */
const PAM_REATTACH_PATHS = [
  '/opt/homebrew/lib/pam/pam_reattach.so', // Apple Silicon
  '/usr/local/lib/pam/pam_reattach.so',    // Intel
];

/** Regex matching an *uncommented* pam_tid.so line at any indent. */
const ACTIVE_PATTERN = /^[\t ]*auth\s+sufficient\s+pam_tid\.so\b/m;
/** Regex matching a *commented* pam_tid.so line. */
const COMMENTED_PATTERN = /^([\t ]*)#+\s*(auth\s+sufficient\s+pam_tid\.so\b.*)$/m;
/** Regex matching an *uncommented* pam_reattach line (any install path). */
const REATTACH_PATTERN = /^[\t ]*auth\s+optional\s+\S*pam_reattach\.so\b/m;

export function readSudoLocal(): string | null {
  if (!existsSync(SUDO_LOCAL)) return null;
  try {
    return readFileSync(SUDO_LOCAL, 'utf-8');
  } catch {
    return null;
  }
}

/** Is Touch ID currently enabled for sudo? */
export function isTouchIdEnabled(): boolean {
  const content = readSudoLocal();
  if (content == null) return false;
  return ACTIVE_PATTERN.test(content);
}

/** Returns the absolute path to an installed pam_reattach.so, or null. */
export function findPamReattachPath(): string | null {
  for (const p of PAM_REATTACH_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function isPamReattachInstalled(): boolean {
  return findPamReattachPath() !== null;
}

export function installPamReattachViaBrew(): void {
  execFileSync('brew', ['install', 'pam-reattach'], { stdio: 'inherit' });
}

export function hasTouchIdHardware(): boolean {
  // `bioutil -rs` reads systemwide biometrics settings. It exits 0 and
  // prints "System Touch ID configuration:" on any machine with the sensor
  // (all Apple Silicon MacBooks, Intel MBPs with Touch Bar or Magic Keyboard
  // with Touch ID). Exits non-zero on machines without the hardware.
  try {
    const output = execFileSync('bioutil', ['-rs'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return /touch id/i.test(output);
  } catch {
    return false;
  }
}

function reattachLine(path: string): string {
  return `auth       optional       ${path}`;
}

/**
 * Compute the content we'd write to enable Touch ID. When `reattachPath`
 * is provided (pam_reattach installed), we also ensure it precedes pam_tid,
 * since pam is evaluated top-to-bottom and reattach must run first.
 */
export function computeEnabledContent(
  existing: string | null,
  reattachPath: string | null = null,
): { changed: boolean; next: string } {
  // Start fresh.
  if (existing == null) {
    const lines = [OCC_MARKER];
    if (reattachPath) lines.push(reattachLine(reattachPath));
    lines.push(PAM_TID_LINE);
    return { changed: true, next: lines.join('\n') + '\n' };
  }

  let next = existing;
  let changed = false;

  // 1. Ensure pam_tid is uncommented / present.
  if (!ACTIVE_PATTERN.test(next)) {
    if (COMMENTED_PATTERN.test(next)) {
      next = next.replace(COMMENTED_PATTERN, '$1$2');
    } else {
      const suffix = next.endsWith('\n') ? '' : '\n';
      next = `${next}${suffix}${OCC_MARKER}\n${PAM_TID_LINE}\n`;
    }
    changed = true;
  }

  // 2. Ensure pam_reattach is present BEFORE pam_tid (if available).
  if (reattachPath && !REATTACH_PATTERN.test(next)) {
    // Insert reattach line immediately before the pam_tid line.
    const insertLine = reattachLine(reattachPath);
    next = next.replace(
      /^([\t ]*)(auth\s+sufficient\s+pam_tid\.so\b.*)$/m,
      `$1${insertLine}\n$1$2`,
    );
    changed = true;
  }

  return { changed, next };
}

/** Compute content that disables Touch ID — comments out any active pam_tid line. */
export function computeDisabledContent(existing: string | null): { changed: boolean; next: string | null } {
  if (existing == null) {
    return { changed: false, next: null }; // file doesn't exist — nothing to do
  }
  if (!ACTIVE_PATTERN.test(existing)) {
    return { changed: false, next: existing }; // already inactive
  }
  const next = existing.replace(
    /^([\t ]*)(auth\s+sufficient\s+pam_tid\.so\b.*)$/m,
    '$1#$2',
  );
  return { changed: true, next };
}

/**
 * Writes `content` to /etc/pam.d/sudo_local via `sudo tee`. Runs with
 * inherited stdio so sudo's password prompt (or Touch ID if already
 * enabled!) reaches the user. Throws on failure.
 */
export function writeSudoLocal(content: string): void {
  execFileSync('sudo', ['tee', SUDO_LOCAL], {
    input: content,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  // tee streams input to stdout too; we ignore that. The permission bits
  // macOS wants on sudo_local are 0444 by default; tee writes 0644 or so.
  // Apply the expected bits explicitly — some pam implementations are strict.
  try {
    execFileSync('sudo', ['chmod', '0644', SUDO_LOCAL], { stdio: 'pipe' });
  } catch {
    // best effort
  }
}

/** Get the template path, null if not present (non-macOS or very old macOS). */
export function getTemplatePath(): string | null {
  return existsSync(SUDO_LOCAL_TEMPLATE) ? SUDO_LOCAL_TEMPLATE : null;
}

export function sudoLocalPath(): string {
  return SUDO_LOCAL;
}
