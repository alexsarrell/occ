export type ConnectionState =
  | 'idle'
  | 'waiting-sudo'
  | 'authenticating'
  | 'waiting-otp'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'disconnected';

export interface ParseResult {
  state: ConnectionState;
  message?: string;
}

export function parseOpenConnectOutput(data: string): ParseResult | null {
  // Sudo prompt: "Password:" at the very start of the line, capital P
  if (/^Password:\s*$/m.test(data)) {
    return { state: 'waiting-sudo' };
  }

  // Tunnel creation error — check before generic "failed" to avoid false positives
  if (/(?:failed to connect utun|failed to open tun|set up tun device failed|operation not permitted)/i.test(data)) {
    return { state: 'failed', message: 'Could not create macOS tunnel. Try running again and approve the sudo prompt.' };
  }

  // Auth failure — check before generic password prompt
  if (/(?:authentication failed|login denied|permission denied)/i.test(data)) {
    return { state: 'failed', message: 'Authentication failed' };
  }

  // VPN password/passcode prompt (case-insensitive, may have prefix text)
  if (/(?:password|passcode):\s*$/im.test(data)) {
    return { state: 'authenticating' };
  }

  // OTP / second factor prompt
  if (/(?:second factor|verification code|otp|token|challenge)/i.test(data)) {
    return { state: 'waiting-otp' };
  }

  // Successful connection
  if (/(?:got connect response|connected as|esp session established|dtls connection established)/i.test(data)) {
    return { state: 'connected' };
  }

  return null;
}
