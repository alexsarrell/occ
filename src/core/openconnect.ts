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

/** Gets the primary IPv4 of an interface. Returns null on failure. */
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

export class OpenConnectManager extends EventEmitter<OpenConnectManagerEvents> {
  private ptyProcess: IPty | null = null;
  private currentState: ConnectionState = 'idle';
  private logBuffer: string[] = [];
  private partialLine = '';
  private netPollTimer: NodeJS.Timeout | null = null;
  private wakeTickTimer: NodeJS.Timeout | null = null;
  private lastInterface: string | null = null;
  private lastIp: string | null = null;
  private lastTick = Date.now();

  async connect(profile: Profile): Promise<void> {
    const pty = await import('node-pty');

    const args = [
      '-p', 'Password: ',
      'openconnect',
      `--user=${profile.username}`,
      `--reconnect-timeout=${profile.reconnectTimeout ?? 300}`,
    ];

    if (profile.noDtls !== false) {
      args.push('--no-dtls');
    }

    // Use bundled split-DNS script unless profile opts out. The script uses
    // scutil's Dynamic Store so DNS never gets stuck in persistent prefs
    // after an ungraceful exit.
    if (!profile.useDefaultScript) {
      const scriptPath = getBundledScriptPath();
      if (scriptPath) {
        args.push(`--script=${scriptPath}`);
      }
    }

    args.push(profile.server);

    this.ptyProcess = pty.spawn('sudo', args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
    });

    this.setState('idle');

    this.ptyProcess.onData((data: string) => {
      this.emit('output', data);
      this.appendToLogs(data);
      const result = parseOpenConnectOutput(data);
      if (result) {
        this.setState(result.state, result.message);
      }
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.setState('disconnected');
      this.emit('exit', exitCode);
      this.stopMonitoring();
    });

    this.startMonitoring();
  }

  sendInput(text: string): void {
    this.ptyProcess?.write(text + '\r');
  }

  /**
   * Request a soft reconnect via SIGUSR2. openconnect will re-establish
   * the tunnel using the existing session (no re-auth/OTP needed).
   *
   * sudo forwards SIGUSR2 to its child per its docs, and we can signal
   * sudo because our real UID still matches sudo's real UID even though
   * sudo's effective UID is 0.
   *
   * Returns true on apparent success, false if no process to signal.
   */
  reconnect(): boolean {
    if (!this.ptyProcess) return false;
    try {
      process.kill(this.ptyProcess.pid!, 'SIGUSR2');
      this.pushLogLine('[occ] SIGUSR2 sent — requesting reconnect (no re-auth)');
      return true;
    } catch (e) {
      // Fallback: try pkill via sudo -n (uses cached sudo creds).
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

  /** Hard reset — kills openconnect. Caller must re-authenticate. */
  disconnect(): void {
    this.stopMonitoring();
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
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
    // node-pty emits arbitrary chunks — split by newlines ourselves.
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

  // ---------------- Monitoring (network change + wake-from-sleep) ---------

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
