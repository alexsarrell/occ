import { execFileSync } from 'node:child_process';
import { getPrimaryPhysicalService, getDnsServers, resetDns } from './dns.js';

export interface HealResult {
  healed: boolean;
  reason: string;
  service?: string;
  previousDns?: string[];
}

function isOpenConnectRunning(): boolean {
  try {
    execFileSync('pgrep', ['openconnect'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decides whether the system has zombie VPN DNS state. True when:
 *   - openconnect is NOT running (so no live session to preserve)
 *   - AND the primary physical service has custom DNS servers set
 *     (typical symptom of a VPN that exited ungracefully)
 *
 * This is a heuristic: if the user happens to have manually set a custom
 * DNS (e.g. 1.1.1.1) as a permanent preference, we'd wipe it. Acceptable
 * trade-off given the alternative is broken internet after every crash.
 */
export function diagnose(): HealResult {
  if (isOpenConnectRunning()) {
    return { healed: false, reason: 'openconnect is running — leaving DNS alone' };
  }

  const service = getPrimaryPhysicalService();
  if (!service) {
    return { healed: false, reason: 'no primary physical network service found' };
  }

  const dns = getDnsServers(service);
  if (dns.length === 0) {
    return { healed: false, reason: `DNS on '${service}' is already automatic (DHCP)`, service };
  }

  return {
    healed: false, // not yet — diagnose doesn't mutate
    reason: `zombie DNS on '${service}': ${dns.join(', ')}`,
    service,
    previousDns: dns,
  };
}

/**
 * Diagnose + fix. Returns what happened so the caller can log or surface it.
 * Safe to call any time — no-op if the system looks fine.
 */
export function heal(): HealResult {
  const d = diagnose();
  if (!d.service || !d.previousDns) {
    return d; // nothing to heal
  }
  const ok = resetDns();
  return {
    healed: ok,
    reason: ok
      ? `reset DNS on '${d.service}' (was: ${d.previousDns.join(', ')})`
      : `tried to reset DNS on '${d.service}' but sudo -n failed — run 'occ clean' manually`,
    service: d.service,
    previousDns: d.previousDns,
  };
}
