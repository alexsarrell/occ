import { describe, it, expect } from 'vitest';
import { generate, base32Encode, base32Decode, parseMigrationUrl } from '../../src/core/totp.js';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const samples = [
      Buffer.from([]),
      Buffer.from([0]),
      Buffer.from([0xff]),
      Buffer.from('hello world'),
      Buffer.from('abcdef0123456789', 'hex'),
    ];
    for (const s of samples) {
      expect(base32Decode(base32Encode(s))).toEqual(s);
    }
  });

  it('decodes a known base32 string to expected bytes', () => {
    // "Hello!" + 0xde 0xad 0xbe 0xef encoded as base32.
    expect(base32Decode('JBSWY3DPEHPK3PXP').toString('hex')).toBe('48656c6c6f21deadbeef');
  });
});

describe('generate', () => {
  // RFC 6238 test vector for 30-second TOTP-SHA1, secret = "12345678901234567890".
  // At t=59 → 287082, t=1111111109 → 081804.
  const SECRET_ASCII = '12345678901234567890';
  const SECRET_B32 = base32Encode(Buffer.from(SECRET_ASCII));

  it('matches RFC 6238 vector at t=59', () => {
    expect(generate(SECRET_B32, 59)).toBe('287082');
  });

  it('matches RFC 6238 vector at t=1111111109', () => {
    expect(generate(SECRET_B32, 1111111109)).toBe('081804');
  });

  it('zero-pads short codes to 6 digits', () => {
    const code = generate(SECRET_B32, 1234567890);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
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

  it('parses a synthetic migration payload', () => {
    // Hand-craft a MigrationPayload protobuf with a single OtpParameters entry.
    // Layout (Google Authenticator format):
    //   tag 1 (otp_parameters), wire 2, length-prefixed:
    //     tag 1 (secret) wire 2 -> 4 bytes 0xde 0xad 0xbe 0xef
    //     tag 2 (name)   wire 2 -> "alice"
    //     tag 3 (issuer) wire 2 -> "test"
    const otp = Buffer.concat([
      Buffer.from([0x0a, 0x04, 0xde, 0xad, 0xbe, 0xef]), // secret
      Buffer.from([0x12, 0x05]), Buffer.from('alice'),    // name
      Buffer.from([0x1a, 0x04]), Buffer.from('test'),     // issuer
    ]);
    const payload = Buffer.concat([
      Buffer.from([0x0a, otp.length]),
      otp,
    ]);
    const url = `otpauth-migration://offline?data=${encodeURIComponent(payload.toString('base64'))}`;

    const entries = parseMigrationUrl(url);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('alice');
    expect(entries[0].issuer).toBe('test');
    expect(entries[0].secret).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    expect(entries[0].label).toBe('test (alice)');
  });
});
