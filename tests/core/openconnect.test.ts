import { describe, it, expect } from 'vitest';
import { extractGatewayHost } from '../../src/core/openconnect.js';

describe('extractGatewayHost', () => {
  it('strips the https:// scheme', () => {
    expect(extractGatewayHost('https://vpn-sls.just-ai.com')).toBe('vpn-sls.just-ai.com');
  });

  it('passes through a bare hostname', () => {
    expect(extractGatewayHost('vpn-azr.tovie.ai')).toBe('vpn-azr.tovie.ai');
  });

  it('strips a trailing port', () => {
    expect(extractGatewayHost('https://vpn.example.com:8443')).toBe('vpn.example.com');
  });

  it('strips a path', () => {
    expect(extractGatewayHost('https://vpn.example.com/portal')).toBe('vpn.example.com');
  });

  it('strips user info', () => {
    expect(extractGatewayHost('https://user@vpn.example.com')).toBe('vpn.example.com');
  });

  it('handles an IPv4 literal', () => {
    expect(extractGatewayHost('https://10.0.0.1')).toBe('10.0.0.1');
  });

  it('trims surrounding whitespace', () => {
    expect(extractGatewayHost('  vpn.example.com  ')).toBe('vpn.example.com');
  });

  // Defensive: anything that could break out of the shell context must be
  // refused so we never inject it into `route delete`.
  it('rejects shell metacharacters', () => {
    expect(extractGatewayHost('vpn.example.com; rm -rf /')).toBeNull();
    expect(extractGatewayHost('$(whoami)')).toBeNull();
    expect(extractGatewayHost('a b')).toBeNull();
  });

  it('rejects empty / missing input', () => {
    expect(extractGatewayHost('')).toBeNull();
    // @ts-expect-error — guarding the runtime path for undefined
    expect(extractGatewayHost(undefined)).toBeNull();
  });
});
