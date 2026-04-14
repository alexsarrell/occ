import { execFileSync } from 'node:child_process';

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

export function resetDns(): boolean {
  const iface = getActiveInterface();
  if (!iface) return false;

  const service = getServiceName(iface);
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
  const iface = getActiveInterface();
  if (!iface) {
    throw new Error('Could not detect active network interface');
  }

  const service = getServiceName(iface);
  if (!service) {
    throw new Error(`Could not find network service for interface '${iface}'`);
  }

  // stdio: 'inherit' — sudo can prompt the user
  execFileSync('sudo', ['networksetup', '-setdnsservers', service, 'empty'], { stdio: 'inherit' });
  execFileSync('sudo', ['dscacheutil', '-flushcache'], { stdio: 'inherit' });
  execFileSync('sudo', ['killall', '-HUP', 'mDNSResponder'], { stdio: 'inherit' });
}

export function flushRoutes(): void {
  execFileSync('sudo', ['route', '-n', 'flush'], { stdio: 'inherit' });
}
