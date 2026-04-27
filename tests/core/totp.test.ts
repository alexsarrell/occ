import { describe, it, expect } from 'vitest';
import * as OTPAuth from 'otpauth';
import { generateFromUri, parseMigrationUrl } from '../../src/core/totp.js';

describe('generateFromUri', () => {
  it('produces the same code as otpauth.TOTP for a given URI + timestamp', () => {
    const totp = new OTPAuth.TOTP({
      issuer: 'test', label: 'alice',
      algorithm: 'SHA1', digits: 6, period: 30,
      secret: OTPAuth.Secret.fromBase32('JBSWY3DPEHPK3PXP'),
    });
    const t = 1700000000;
    const expected = totp.generate({ timestamp: t * 1000 });
    expect(generateFromUri(totp.toString(), t)).toBe(expected);
  });
});

describe('parseMigrationUrl', () => {
  it('rejects non-migration URLs', () => {
    expect(() => parseMigrationUrl('https://example.com')).toThrow(/otpauth-migration/);
    expect(() => parseMigrationUrl('otpauth://totp/x?secret=ABC')).toThrow(/otpauth-migration/);
  });

  it('rejects URL with no data param', () => {
    expect(() => parseMigrationUrl('otpauth-migration://offline?')).toThrow(/data/);
  });

  it('parses a synthetic migration payload into a usable otpauth:// URI', () => {
    // Hand-craft a MigrationPayload with one OtpParameters entry:
    //   secret = 0xde 0xad 0xbe 0xef  (raw bytes — base32 encodes to 3225XXX)
    //   name   = "alice"
    //   issuer = "test"
    //   algorithm + digits + type fields omitted → defaults (SHA1/6/TOTP)
    const otp = Buffer.concat([
      Buffer.from([0x0a, 0x04, 0xde, 0xad, 0xbe, 0xef]),
      Buffer.from([0x12, 0x05]), Buffer.from('alice'),
      Buffer.from([0x1a, 0x04]), Buffer.from('test'),
    ]);
    const payload = Buffer.concat([Buffer.from([0x0a, otp.length]), otp]);
    const url = `otpauth-migration://offline?data=${encodeURIComponent(payload.toString('base64'))}`;

    const entries = parseMigrationUrl(url);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('alice');
    expect(entries[0].issuer).toBe('test');
    expect(entries[0].algorithm).toBe('SHA1');
    expect(entries[0].digits).toBe(6);
    expect(entries[0].uri).toMatch(/^otpauth:\/\/totp\//);
    expect(entries[0].uri).toContain('secret=');
    expect(entries[0].uri).toContain('issuer=test');

    // Round-trip: the URI parses back into a TOTP we can generate from.
    const code = generateFromUri(entries[0].uri, 1700000000);
    expect(code).toMatch(/^\d{6}$/);
  });
});
