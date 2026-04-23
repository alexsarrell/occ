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
 *   1. ensureSudo() — checks `sudo -n true` first. If not cached, spawns
 *      `sudo -v` in a dedicated pty. That pty ONLY sees sudo output, so
 *      "Password:" there is UNAMBIGUOUSLY the sudo password prompt. User
 *      input goes through submitSudoPassword(). Touch ID (with pam_reattach)
 *      authenticates out-of-band and sudo -v exits successfully.
 *
 *   2. After sudo is cached, spawns `sudo -n openconnect ...` in a separate
 *      pty. This pty NEVER sees sudo prompts (non-interactive), so every
 *      "Password:" there is unambiguously a VPN password prompt. No
 *      sudoDoneRef flags, no counters, no heuristics.
 *
 * Event semantics:
 *   - state 'waiting-sudo' means authPty is waiting on sudo password
 *   - states 'authenticating' / 'waiting-otp' / 'connected' come from the
 *     openconnect pty exclusively
 */
export class OpenConnectManager extends EventEmitter<OpenConnectManagerEvents> {
  private authPty: IPty | null = null;
  private ocPty: IPty | null = null;
  private currentState: ConnectionState = 'idle';
  private logBuffer: string[] = [];
  private partialLine = '';
  private netPollTimer: NodeJS.Timeout | null = null;
  private wakeTickTimer: NodeJS.Timeout | null = null;
  private lastInterface: string | null = null;
  private lastIp: string | null = null;
  private lastTick = Date.now();

  async connect(profile: Profile): Promise<void> {
    this.setState('idle');

    const sudoOk = await this.ensureSudo();
    if (!sudoOk) {
      this.setState('failed', 'Sudo authentication failed');
      return;
    }

    await this.spawnOpenconnect(profile);
    this.startMonitoring();
  }

  // ---------------- Sudo authentication ----------------

  private isSudoCached(): boolean {
    try {
      execFileSync('sudo', ['-n', 'true'], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  private async ensureSudo(): Promise<boolean> {
    if (this.isSudoCached()) {
      this.pushLogLine('[occ] sudo creds already cached — skipping auth');
      return true;
    }
    return this.authenticateSudo();
  }

  private async authenticateSudo(): Promise<boolean> {
    const pty = await import('node-pty');
    return new Promise((resolve) => {
      this.setState('waiting-sudo');
      this.authPty = pty.spawn('sudo', ['-v'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
      });

      this.authPty.onData((data: string) => {
        this.emit('output', data);
        this.appendToLogs(data);
      });

      this.authPty.onExit(({ exitCode }: { exitCode: number }) => {
        this.authPty = null;
        resolve(exitCode === 0);
      });
    });
  }

  /** Send the sudo password typed by the user into the auth pty. */
  submitSudoPassword(password: string): void {
    this.authPty?.write(password + '\r');
  }

  // ---------------- OpenConnect ----------------

  private async spawnOpenconnect(profile: Profile): Promise<void> {
    const pty = await import('node-pty');

    const args = [
      '-n', // non-interactive — sudo creds already cached, never prompts
      'openconnect',
      `--user=${profile.username}`,
      `--reconnect-timeout=${profile.reconnectTimeout ?? 300}`,
    ];

    if (profile.noDtls !== false) {
      args.push('--no-dtls');
    }

    if (!profile.useDefaultScript) {
      const scriptPath = getBundledScriptPath();
      if (scriptPath) {
        args.push(`--script=${scriptPath}`);
      }
    }

    args.push(profile.server);

    this.ocPty = pty.spawn('sudo', args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
    });

    this.ocPty.onData((data: string) => {
      this.emit('output', data);
      this.appendToLogs(data);
      const result = parseOpenConnectOutput(data);
      if (result) {
        this.setState(result.state, result.message);
      }
    });

    this.ocPty.onExit(({ exitCode }: { exitCode: number }) => {
      this.setState('disconnected');
      this.emit('exit', exitCode);
      this.stopMonitoring();
    });
  }

  /** Send input (VPN password, OTP) into the openconnect pty. */
  sendInput(text: string): void {
    this.ocPty?.write(text + '\r');
  }

  // ---------------- Reconnect / disconnect ----------------

  /** SIGUSR2 → openconnect re-establishes with existing session (no re-auth). */
  reconnect(): boolean {
    if (!this.ocPty) return false;
    try {
      process.kill(this.ocPty.pid!, 'SIGUSR2');
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
    if (this.authPty) {
      try { this.authPty.kill('SIGTERM'); } catch { /* may be dead */ }
      this.authPty = null;
    }
    if (this.ocPty) {
      try { this.ocPty.kill('SIGTERM'); } catch { /* may be dead */ }
      this.ocPty = null;
    }
  }

  // ---------------- State + logs ----------------

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

  // ---------------- Monitoring (network change + wake-from-sleep) ----------------

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
