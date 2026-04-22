import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, chmodSync } from 'node:fs';

/**
 * Resolves the absolute path to our bundled vpnc-script.
 *
 * At runtime our code lives in `dist/cli.js` (bundled by tsup). The script
 * is shipped next to dist/ under `scripts/occ-vpnc-script`, included via
 * the `files` array in package.json.
 *
 * Returns null if the script cannot be located — callers fall back to
 * openconnect's default vpnc-script in that case.
 */
export function getBundledScriptPath(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/cli.js → ../scripts/occ-vpnc-script
    const candidate = join(here, '..', 'scripts', 'occ-vpnc-script');
    if (existsSync(candidate)) {
      // Ensure executable bit — npm tarball extraction sometimes drops it.
      try {
        chmodSync(candidate, 0o755);
      } catch {
        // best effort; if we can't chmod, openconnect will fail loudly
      }
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}
