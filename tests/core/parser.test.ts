import { describe, it, expect } from 'vitest';
import { parseOpenConnectOutput } from '../../src/core/parser.js';

describe('parseOpenConnectOutput', () => {
  it('detects sudo password prompt', () => {
    expect(parseOpenConnectOutput('Password: ')).toEqual({ state: 'waiting-sudo' });
  });

  it('detects VPN password prompt (lowercase)', () => {
    expect(parseOpenConnectOutput('password: ')).toEqual({ state: 'authenticating' });
  });

  it('detects VPN passcode prompt', () => {
    expect(parseOpenConnectOutput('Passcode: ')).toEqual({ state: 'authenticating' });
  });

  it('detects OTP prompt (second factor)', () => {
    expect(parseOpenConnectOutput('Enter second factor: ')).toEqual({ state: 'waiting-otp' });
  });

  it('detects OTP prompt (verification code)', () => {
    expect(parseOpenConnectOutput('Verification code: ')).toEqual({ state: 'waiting-otp' });
  });

  it('detects OTP prompt (challenge)', () => {
    expect(parseOpenConnectOutput('Response to challenge: ')).toEqual({ state: 'waiting-otp' });
  });

  it('detects successful connection (connected as)', () => {
    expect(parseOpenConnectOutput('Connected as 10.0.0.5, using SSL')).toEqual({ state: 'connected' });
  });

  it('detects successful connection (got connect response)', () => {
    expect(parseOpenConnectOutput('Got CONNECT response: HTTP/1.1 200 OK')).toEqual({ state: 'connected' });
  });

  it('detects successful connection (ESP session)', () => {
    expect(parseOpenConnectOutput('ESP session established')).toEqual({ state: 'connected' });
  });

  it('detects successful connection (DTLS)', () => {
    expect(parseOpenConnectOutput('DTLS connection established')).toEqual({ state: 'connected' });
  });

  it('detects tunnel error', () => {
    expect(parseOpenConnectOutput('Failed to open tun device')).toEqual({ state: 'failed', message: 'Could not create macOS tunnel. Try running again and approve the sudo prompt.' });
  });

  it('detects utun error', () => {
    expect(parseOpenConnectOutput('Failed to connect utun unit')).toEqual({ state: 'failed', message: 'Could not create macOS tunnel. Try running again and approve the sudo prompt.' });
  });

  it('detects auth failure', () => {
    expect(parseOpenConnectOutput('Authentication failed')).toEqual({ state: 'failed', message: 'Authentication failed' });
  });

  it('detects login denied', () => {
    expect(parseOpenConnectOutput('Login denied')).toEqual({ state: 'failed', message: 'Authentication failed' });
  });

  it('returns null for unrecognized output', () => {
    expect(parseOpenConnectOutput('some random log line')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOpenConnectOutput('')).toBeNull();
  });

  it('distinguishes sudo Password: from VPN password:', () => {
    expect(parseOpenConnectOutput('Password: ')?.state).toBe('waiting-sudo');
    expect(parseOpenConnectOutput('VPN password: ')?.state).toBe('authenticating');
  });
});
