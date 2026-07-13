import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = join(repoRoot, 'scripts', 'occ-vpnc-script');
const tempDirs: string[] = [];

interface RunOptions {
  env?: Record<string, string>;
  state?: string;
}

interface RunResult {
  trace: string;
  state: string;
  log: string;
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function runVpncScript(reason: string, options: RunOptions = {}): RunResult {
  const root = mkdtempSync(join(tmpdir(), 'occ-vpnc-test-'));
  tempDirs.push(root);
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const stateDir = join(home, '.occ');
  const tracePath = join(root, 'trace.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(tracePath, '');

  writeExecutable(join(bin, 'route'), `#!/bin/sh
printf 'route %s\\n' "$*" >> "$TRACE"
if [ "$1" = "-n" ] && [ "$2" = "get" ]; then
  if [ "$3" = "default" ]; then
    cat <<EOF
   route to: default
destination: default
    gateway: \${TEST_DEFAULT_GW:-192.168.0.1}
  interface: \${TEST_DEFAULT_IF:-en0}
EOF
  else
    cat <<EOF
   route to: $3
destination: $3
    gateway: \${TEST_PINNED_GW:-192.168.99.1}
  interface: \${TEST_PINNED_IF:-en0}
EOF
  fi
fi
exit 0
`);

  writeExecutable(join(bin, 'scutil'), `#!/bin/sh
input=$(cat)
{
  echo 'scutil <<'
  printf '%s\\n' "$input"
  echo '>>'
} >> "$TRACE"
case "$input" in
  *State:/Network/Global/IPv4*)
    cat <<EOF
<dictionary> {
  PrimaryInterface : \${TEST_GLOBAL_IF:-en0}
  Router : \${TEST_GLOBAL_GW:-192.168.0.1}
}
EOF
    ;;
  show*)
    if [ "\${TEST_SCUTIL_STATE:-missing}" = "present" ]; then
      echo '<dictionary> {'
      echo '}'
    else
      echo '  No such key'
    fi
    ;;
esac
exit 0
`);

  writeExecutable(join(bin, 'ifconfig'), `#!/bin/sh
printf 'ifconfig %s\\n' "$*" >> "$TRACE"
exit 0
`);

  writeExecutable(join(bin, 'killall'), `#!/bin/sh
printf 'killall %s\\n' "$*" >> "$TRACE"
exit 0
`);

  if (options.state) {
    writeFileSync(join(stateDir, 'last-script-state'), options.state);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    TRACE: tracePath,
    reason,
    TUNDEV: 'utun9',
    VPNGATEWAY: '203.0.113.10',
    INTERNAL_IP4_ADDRESS: '10.46.1.50',
    INTERNAL_IP4_DNS: '10.46.1.1',
    INTERNAL_IP4_MTU: '1378',
    CISCO_SPLIT_INC: '1',
    CISCO_SPLIT_INC_0_ADDR: '10.40.0.0',
    CISCO_SPLIT_INC_0_MASK: '255.255.0.0',
    CISCO_DEF_DOMAIN: 'corp.example',
    ...options.env,
  };

  execFileSync('/bin/sh', [scriptPath], { env, stdio: 'pipe' });

  const statePath = join(stateDir, 'last-script-state');
  let state = '';
  try {
    state = readFileSync(statePath, 'utf8');
  } catch {
    // Disconnect intentionally removes it.
  }

  return {
    trace: readFileSync(tracePath, 'utf8'),
    state,
    log: readFileSync(join(stateDir, 'vpnc-script.log'), 'utf8'),
  };
}

function savedState(): string {
  return [
    'TUNDEV=utun9',
    'VPNGATEWAY=203.0.113.10',
    'ORIG_DEFAULT_GW=192.168.0.1',
    'ORIG_DEFAULT_IF=en0',
    'FULL_TUNNEL=0',
    '',
  ].join('\n');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('occ-vpnc-script network lifecycle', () => {
  it('uses supplemental DNS without claiming primary status in a split tunnel', () => {
    const result = runVpncScript('connect');

    expect(result.trace).toContain('d.add SupplementalMatchDomains * corp.example');
    expect(result.trace).not.toContain('d.add OverridePrimary # 1');
    expect(result.trace).toContain('route add -net 10.40.0.0 -netmask 255.255.0.0 -interface utun9');
    expect(result.log).toContain("override-primary='no'");
  });

  it('keeps OverridePrimary for a full tunnel', () => {
    const result = runVpncScript('connect', {
      env: {
        CISCO_SPLIT_INC: '',
        CISCO_SPLIT_INC_0_ADDR: '',
        CISCO_SPLIT_INC_0_MASK: '',
      },
    });

    expect(result.trace).toContain('route add default -interface utun9');
    expect(result.trace).toContain('d.add OverridePrimary # 1');
    expect(result.log).toContain("override-primary='yes'");
  });

  it('refreshes only the VPN gateway host route before reconnecting', () => {
    const result = runVpncScript('attempt-reconnect', {
      state: savedState(),
      env: { TEST_DEFAULT_GW: '192.168.42.1', TEST_DEFAULT_IF: 'en7' },
    });

    expect(result.trace).toContain('route delete -host 203.0.113.10');
    expect(result.trace).toContain('route add -host 203.0.113.10 192.168.42.1');
    expect(result.trace).not.toContain('ifconfig ');
    expect(result.trace).not.toContain('killall ');
    expect(result.state).toContain('ORIG_DEFAULT_GW=192.168.42.1');
    expect(result.state).toContain('ORIG_DEFAULT_IF=en7');
  });

  it('leaves an already-correct VPN gateway route untouched', () => {
    const result = runVpncScript('attempt-reconnect', {
      state: savedState(),
      env: {
        TEST_DEFAULT_GW: '192.168.42.1',
        TEST_DEFAULT_IF: 'en7',
        TEST_PINNED_GW: '192.168.42.1',
        TEST_PINNED_IF: 'en7',
      },
    });

    expect(result.trace).not.toContain('route delete -host');
    expect(result.trace).not.toContain('route add -host');
    expect(result.state).toContain('ORIG_DEFAULT_GW=192.168.42.1');
    expect(result.state).toContain('ORIG_DEFAULT_IF=en7');
    expect(result.log).toContain('VPN gateway route already current');
  });

  it('does not rewrite routes or DNS when reconnect preserved Dynamic Store state', () => {
    const result = runVpncScript('reconnect', {
      state: savedState(),
      env: { TEST_SCUTIL_STATE: 'present' },
    });

    expect(result.trace).not.toContain('route add');
    expect(result.trace).not.toContain('ifconfig ');
    expect(result.trace).not.toContain('killall ');
    expect(result.log).toContain('reconnect preserved network state; no reconfiguration needed');
  });

  it('restores only missing Dynamic Store state after reconnect', () => {
    const result = runVpncScript('reconnect', {
      state: savedState(),
      env: { TEST_SCUTIL_STATE: 'missing' },
    });

    expect(result.trace).toContain('d.add SupplementalMatchDomains * corp.example');
    expect(result.trace).not.toContain('d.add OverridePrimary # 1');
    expect(result.trace).not.toContain('route add');
    expect(result.trace).not.toContain('ifconfig ');
    expect(result.trace).toContain('killall -HUP mDNSResponder');
    expect(result.log).toContain('reconnect restored missing Dynamic Store state');
  });

  it('loads the saved tunnel identifier before disconnect cleanup', () => {
    const result = runVpncScript('disconnect', {
      state: savedState(),
      env: { TUNDEV: '' },
    });

    expect(result.trace).toContain('remove State:/Network/Service/utun9/DNS');
    expect(result.trace).toContain('remove State:/Network/Service/utun9/IPv4');
    expect(result.trace).not.toMatch(/State:\/Network\/Service\/occ-\d+\/DNS/);
  });
});
