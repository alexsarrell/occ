import { EventEmitter } from 'node:events';
import { type IPty } from 'node-pty';
import { parseOpenConnectOutput, type ConnectionState } from './parser.js';
import type { Profile } from '../config/types.js';

interface OpenConnectManagerEvents {
  state: [ConnectionState, string?];
  output: [string];
  exit: [number];
}

export class OpenConnectManager extends EventEmitter<OpenConnectManagerEvents> {
  private ptyProcess: IPty | null = null;
  private currentState: ConnectionState = 'idle';

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

    args.push(profile.server);

    this.ptyProcess = pty.spawn('sudo', args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
    });

    this.setState('idle');

    this.ptyProcess.onData((data: string) => {
      this.emit('output', data);
      const result = parseOpenConnectOutput(data);
      if (result) {
        this.setState(result.state, result.message);
      }
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.setState('disconnected');
      this.emit('exit', exitCode);
    });
  }

  sendInput(text: string): void {
    this.ptyProcess?.write(text + '\r');
  }

  disconnect(): void {
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

  private setState(state: ConnectionState, message?: string): void {
    this.currentState = state;
    this.emit('state', state, message);
  }
}
