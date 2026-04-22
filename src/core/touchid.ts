import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SUDO_LOCAL = '/etc/pam.d/sudo_local';
const SUDO_LOCAL_TEMPLATE = '/etc/pam.d/sudo_local.template';

const PAM_TID_LINE = 'auth       sufficient     pam_tid.so';
const OCC_MARKER = '# Added by occ — enables Touch ID for sudo';

/** Regex matching an *uncommented* pam_tid.so line at any indent. */
const ACTIVE_PATTERN = /^[\t ]*auth\s+sufficient\s+pam_tid\.so\b/m;
/** Regex matching a *commented* pam_tid.so line. */
const COMMENTED_PATTERN = /^([\t ]*)#+\s*(auth\s+sufficient\s+pam_tid\.so\b.*)$/m;

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

/** Compute the content we'd write to enable Touch ID, based on existing file. */
export function computeEnabledContent(existing: string | null): { changed: boolean; next: string } {
  if (existing == null) {
    // Fresh file.
    return {
      changed: true,
      next: `${OCC_MARKER}\n${PAM_TID_LINE}\n`,
    };
  }

  if (ACTIVE_PATTERN.test(existing)) {
    return { changed: false, next: existing }; // already enabled
  }

  if (COMMENTED_PATTERN.test(existing)) {
    // Uncomment the existing line — preserve indentation.
    const next = existing.replace(COMMENTED_PATTERN, '$1$2');
    return { changed: true, next };
  }

  // Existing file has other content but no pam_tid line — append.
  const suffix = existing.endsWith('\n') ? '' : '\n';
  return {
    changed: true,
    next: `${existing}${suffix}${OCC_MARKER}\n${PAM_TID_LINE}\n`,
  };
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
