import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { type IPty } from 'node-pty';
import { parseOpenConnectOutput, type ConnectionState } from './parser.js';
import { getPhysicalDefaultInterface } from './dns.js';
import { getBundledScriptPath } from './vpnc-script.js';
import type { Profile } from '../config/types.js';

interface OpenConnectManagerEvents {
  state: [ConnectionState, string?];
  output: [string];
  log: [string];
  exit: [number];
}

const LOG_BUFFER_SIZE = 500;
const NET_POLL_MS = 5_000;
const WAKE_TICK_MS = 1_000;
const WAKE_LAG_THRESHOLD_MS = 10_000;

/** Markers printed by our shell wrapper so the parser can tell when
 *  sudo-auth ends and openconnect begins. */
const SUDO_OK_MARKER = '__OCC_SUDO_OK__';

function getInterfaceIp(iface: string): string | null {
  try {
    return execFileSync('ipconfig', ['getifaddr', iface], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Connection lifecycle:
 *
 * We spawn a single pty running:
 *
 *   sudo -v && echo __OCC_SUDO_OK__ && exec sudo -n openconnect ARGS
 *
 *   - `sudo -v` authenticates (types password, Touch ID via pam_tid, etc).
 *     Output goes through the pty; any "Password:" here is unambiguously
 *     the sudo password prompt.
 *   - After auth succeeds, `__OCC_SUDO_OK__` is printed. The parser flips
 *     into "openconnect mode" — from here any "Password:" is a VPN prompt.
 *   - `exec sudo -n` replaces the shell with openconnect. `-n` guarantees
 *     sudo never prompts again (uses the cache just populated by `sudo -v`).
 *     Using the same pty keeps the tty-scoped sudo credential cache in the
 *     same scope — a separate pty would get tty_tickets isolation and
 *     `sudo -n` would fail.
 *   - If auth fails (3 wrong passwords), the && chain short-circuits, the
 *     shell exits non-zero, onExit fires before we ever reach 'connected'
 *     → we surface 'failed' with a sudo auth message.
 *
 * No heuristics, no counters, no output-sniffing guesswork.
 */
export class OpenConnectManager extends EventEmitter<OpenConnectManagerEvents> {
  private ptyProcess: IPty | null = null;
  private currentState: ConnectionState = 'idle';
  private sudoPassed = false;
  private logBuffer: string[] = [];
  private partialLine = '';
  private netPollTimer: NodeJS.Timeout | null = null;
  private wakeTickTimer: NodeJS.Timeout | null = null;
  private lastInterface: string | null = null;
  private lastIp: string | null = null;
  private lastTick = Date.now();

  async connect(profile: Profile): Promise<void> {
    const pty = await import('node-pty');
    this.sudoPassed = false;
    this.setState('idle');

    const ocArgs = buildOpenconnectArgs(profile);

    // Script passed via -c. Openconnect args go after -- as $1, $2, ...
    // `exec` replaces sh with sudo so pty.pid ends up pointing at the VPN
    // process, which matters for SIGUSR2-based reconnect later.
    const script = `sudo -v && echo "${SUDO_OK_MARKER}" && exec sudo -n openconnect "$@"`;

    this.ptyProcess = pty.spawn('sh', ['-c', script, 'occ-sudo-chain', ...ocArgs], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
    });

    this.setState('waiting-sudo');

    this.ptyProcess.onData((data: string) => {
      this.emit('output', data);
      this.appendToLogs(data);
      this.handleData(data);
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      // If we never got to 'connected', this is an auth/startup failure,
      // not a clean disconnect.
      if (this.currentState !== 'connected' && this.currentState !== 'reconnecting') {
        const msg = !this.sudoPassed
          ? 'Sudo authentication failed'
          : `openconnect exited before connecting (code ${exitCode})`;
        this.setState('failed', msg);
      } else {
        this.setState('disconnected');
      }
      this.emit('exit', exitCode);
      this.stopMonitoring();
    });

    this.startMonitoring();
  }

  /** Routes stdout/stderr chunks to the right parser depending on phase. */
  private handleData(data: string): void {
    if (!this.sudoPassed) {
      if (data.includes(SUDO_OK_MARKER)) {
        this.sudoPassed = true;
        this.pushLogLine('[occ] sudo auth complete — openconnect starting');
        // Re-parse the remainder of the chunk as openconnect output.
        const tail = data.split(SUDO_OK_MARKER).pop() ?? '';
        const result = parseOpenConnectOutput(tail);
        if (result) this.setState(result.state, result.message);
        return;
      }
      // Still in sudo auth phase. Recognize retry / fail patterns.
      if (/Sorry, try again/i.test(data)) {
        this.setState('waiting-sudo', 'Wrong password, try again');
        return;
      }
      // The initial "Password:" prompt doesn't need special handling — UI
      // is already showing sudo input since we setState('waiting-sudo') on
      // spawn.
      return;
    }

    // sudo phase is done; parse output as openconnect.
    const result = parseOpenConnectOutput(data);
    if (result) {
      this.setState(result.state, result.message);
    }
  }

  /** Send any input (sudo password, VPN password, OTP) to the active pty. */
  sendInput(text: string): void {
    this.ptyProcess?.write(text + '\r');
  }

  /** SIGUSR2 → openconnect re-establishes with existing session (no re-auth). */
  reconnect(): boolean {
    if (!this.ptyProcess) return false;
    try {
      process.kill(this.ptyProcess.pid!, 'SIGUSR2');
      this.pushLogLine('[occ] SIGUSR2 sent — requesting reconnect (no re-auth)');
      return true;
    } catch (e) {
      try {
        execFileSync('sudo', ['-n', 'pkill', '-USR2', 'openconnect'], { stdio: 'pipe' });
        this.pushLogLine('[occ] sudo -n pkill -USR2 sent — requesting reconnect');
        return true;
      } catch {
        this.pushLogLine(`[occ] reconnect failed: ${(e as Error).message}`);
        return false;
      }
    }
  }

  disconnect(): void {
    this.stopMonitoring();
    if (this.ptyProcess) {
      try { this.ptyProcess.kill('SIGTERM'); } catch { /* may be dead */ }
      this.ptyProcess = null;
    }
  }

  getState(): ConnectionState {
    return this.currentState;
  }

  getLogs(): string[] {
    return [...this.logBuffer];
  }

  private setState(state: ConnectionState, message?: string): void {
    this.currentState = state;
    this.emit('state', state, message);
  }

  private appendToLogs(data: string): void {
    const combined = this.partialLine + data.replace(/\r\n?/g, '\n');
    const parts = combined.split('\n');
    this.partialLine = parts.pop() ?? '';
    for (const line of parts) {
      // Don't leak our marker into user-visible logs.
      if (line.includes(SUDO_OK_MARKER)) continue;
      this.pushLogLine(line);
    }
  }

  private pushLogLine(line: string): void {
    if (this.logBuffer.length >= LOG_BUFFER_SIZE) {
      this.logBuffer.shift();
    }
    this.logBuffer.push(line);
    this.emit('log', line);
  }

  // ---------------- Monitoring ----------------

  private startMonitoring(): void {
    this.lastInterface = getPhysicalDefaultInterface();
    this.lastIp = this.lastInterface ? getInterfaceIp(this.lastInterface) : null;
    this.lastTick = Date.now();

    this.netPollTimer = setInterval(() => this.checkNetworkChange(), NET_POLL_MS);
    this.wakeTickTimer = setInterval(() => this.checkWakeFromSleep(), WAKE_TICK_MS);
  }

  private stopMonitoring(): void {
    if (this.netPollTimer) {
      clearInterval(this.netPollTimer);
      this.netPollTimer = null;
    }
    if (this.wakeTickTimer) {
      clearInterval(this.wakeTickTimer);
      this.wakeTickTimer = null;
    }
  }

  private checkNetworkChange(): void {
    const iface = getPhysicalDefaultInterface();
    const ip = iface ? getInterfaceIp(iface) : null;

    const ifaceChanged = iface !== this.lastInterface;
    const ipChanged = ip !== this.lastIp;

    if ((ifaceChanged || ipChanged) && this.currentState === 'connected') {
      this.pushLogLine(`[occ] network change detected (iface ${this.lastInterface}→${iface}, ip ${this.lastIp}→${ip}) — reconnecting`);
      this.setState('reconnecting');
      this.reconnect();
    }

    this.lastInterface = iface;
    this.lastIp = ip;
  }

  private checkWakeFromSleep(): void {
    const now = Date.now();
    const lag = now - this.lastTick;
    this.lastTick = now;
    if (lag > WAKE_LAG_THRESHOLD_MS && this.currentState !== 'idle' && this.currentState !== 'disconnected') {
      this.pushLogLine(`[occ] wake-from-sleep detected (lag ${Math.round(lag / 1000)}s) — reconnecting`);
      this.setState('reconnecting');
      this.reconnect();
    }
  }
}

function buildOpenconnectArgs(profile: Profile): string[] {
  const args = [
    `--user=${profile.username}`,
    `--reconnect-timeout=${profile.reconnectTimeout ?? 300}`,
  ];
  if (profile.noDtls !== false) args.push('--no-dtls');
  if (!profile.useDefaultScript) {
    const scriptPath = getBundledScriptPath();
    if (scriptPath) args.push(`--script=${scriptPath}`);
  }
  args.push(profile.server);
  return args;
}
