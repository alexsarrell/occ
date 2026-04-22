import { execFileSync } from 'node:child_process';

const VIRTUAL_PREFIXES = ['utun', 'ipsec', 'ppp', 'gif', 'stf', 'awdl', 'llw', 'lo', 'bridge', 'anpi'];

/** True for VPN/loopback/virtual interfaces — anything that's not a real NIC. */
export function isVirtualInterface(iface: string): boolean {
  return VIRTUAL_PREFIXES.some((p) => iface.startsWith(p));
}

/** Default-route interface (may be a VPN tunnel like utun4 when VPN is active). */
export function getActiveInterface(): string | null {
  try {
    const output = execFileSync('route', ['-n', 'get', 'default'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const match = output.match(/interface:\s+(\S+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the underlying physical interface (en0, en1...). When no VPN is
 * active this matches getActiveInterface(). When a VPN tunnel owns the
 * default route, falls back to the first enabled physical service.
 */
export function getPhysicalDefaultInterface(): string | null {
  const active = getActiveInterface();
  if (active && !isVirtualInterface(active)) return active;

  const services = listPhysicalServices();
  return services[0]?.device ?? null;
}

interface PhysicalService {
  service: string;
  device: string;
}

/**
 * Lists physical (en*) network services in priority order, as macOS sees them.
 * Disabled services (the ones networksetup prints with a leading `*`) are skipped.
 */
function listPhysicalServices(): PhysicalService[] {
  try {
    const output = execFileSync('networksetup', ['-listnetworkserviceorder'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output.split('\n');
    const result: PhysicalService[] = [];
    for (let i = 0; i < lines.length; i++) {
      // Header line: "(N) Service Name" or "(*) Service Name" if disabled
      const header = lines[i].match(/^\((\d+|\*)\)\s+(.+)$/);
      if (!header) continue;
      if (header[1] === '*') continue; // disabled service
      const serviceName = header[2].trim();
      const detail = lines[i + 1] || '';
      const deviceMatch = detail.match(/Device:\s+(\S+?)\)?$/);
      const device = deviceMatch?.[1];
      if (device && !isVirtualInterface(device) && device.startsWith('en')) {
        result.push({ service: serviceName, device });
      }
    }
    return result;
  } catch {
    return [];
  }
}

/** Service name for a given interface (Wi-Fi, Ethernet, ...). */
export function getServiceName(iface: string): string | null {
  try {
    const output = execFileSync('networksetup', ['-listallhardwareports'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`Device: ${iface}`)) {
        const portMatch = lines[i - 1]?.match(/Hardware Port:\s+(.+)/);
        return portMatch?.[1]?.trim() ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the network service name of the primary physical NIC (Wi-Fi, etc.),
 * even when a VPN owns the default route. Returns null if nothing is found.
 */
export function getPrimaryPhysicalService(): string | null {
  const physical = getPhysicalDefaultInterface();
  if (!physical) return null;
  return getServiceName(physical);
}

/**
 * Reads the DNS servers currently configured for a service via networksetup.
 * Returns an empty array when DNS is on "Automatic" (DHCP-provided).
 */
export function getDnsServers(service: string): string[] {
  try {
    const output = execFileSync('networksetup', ['-getdnsservers', service], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // networksetup prints "There aren't any DNS Servers set on <service>." when empty.
    if (/there aren't any dns servers/i.test(output)) return [];
    return output.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function resetDns(): boolean {
  const service = getPrimaryPhysicalService();
  if (!service) return false;

  try {
    // -n flag: non-interactive, fail silently if sudo not cached
    execFileSync('sudo', ['-n', 'networksetup', '-setdnsservers', service, 'empty'], { stdio: 'pipe' });
    execFileSync('sudo', ['-n', 'dscacheutil', '-flushcache'], { stdio: 'pipe' });
    execFileSync('sudo', ['-n', 'killall', '-HUP', 'mDNSResponder'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function resetDnsInteractive(): void {
  const service = getPrimaryPhysicalService();
  if (!service) {
    throw new Error('Could not find a physical network service to reset DNS on');
  }

  // stdio: 'inherit' — sudo can prompt the user
  execFileSync('sudo', ['networksetup', '-setdnsservers', service, 'empty'], { stdio: 'inherit' });
  execFileSync('sudo', ['dscacheutil', '-flushcache'], { stdio: 'inherit' });
  execFileSync('sudo', ['killall', '-HUP', 'mDNSResponder'], { stdio: 'inherit' });
}

export function flushRoutes(): void {
  execFileSync('sudo', ['route', '-n', 'flush'], { stdio: 'inherit' });
}
