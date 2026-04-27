import * as OTPAuth from 'otpauth';

/**
 * TOTP support: thin wrappers around `otpauth` (battle-tested library that
 * handles SHA1/SHA256/SHA512, 6/8 digits, arbitrary period — everything
 * RFC 6238 prescribes, plus the otpauth:// URI standard) plus a small
 * protobuf parser for Google Authenticator's export format, which `otpauth`
 * doesn't ship.
 *
 * Storage convention: a complete `otpauth://totp/...` URI goes into the
 * macOS Keychain entry. That URI carries every parameter (algorithm,
 * digits, period, issuer, name, secret) in a single standard string, so
 * `occ` and any other TOTP-aware tool can read or re-import it without
 * needing per-account metadata stored elsewhere.
 */

export interface OtpEntry {
  uri: string;        // canonical otpauth://totp/... URI
  name: string;       // account label
  issuer: string;     // service/issuer (may be empty)
  label: string;      // display text combining issuer + name
  algorithm: string;  // SHA1 / SHA256 / SHA512
  digits: number;     // 6 or 8
  period: number;     // seconds (typically 30)
}

/** Generate the current TOTP code from an otpauth:// URI string. */
export function generateFromUri(uri: string, atUnixSec: number = Date.now() / 1000): string {
  const totp = OTPAuth.URI.parse(uri) as OTPAuth.TOTP;
  return totp.generate({ timestamp: Math.floor(atUnixSec * 1000) });
}

/** Seconds remaining in the current period window — for UI hints. */
export function secondsRemaining(period = 30, atUnixSec: number = Date.now() / 1000): number {
  return period - Math.floor(atUnixSec) % period;
}

// ---------- otpauth-migration parsing (Google Authenticator export QR) ----------

export function parseMigrationUrl(url: string): OtpEntry[] {
  const u = new URL(url);
  if (u.protocol !== 'otpauth-migration:') {
    throw new Error(`expected otpauth-migration:// URL, got ${u.protocol}`);
  }
  const data = u.searchParams.get('data');
  if (!data) throw new Error('migration URL has no `data` param');
  const buf = Buffer.from(decodeURIComponent(data), 'base64');
  return parseMigrationPayload(buf);
}

const ALG_MAP: Record<number, string> = {
  0: 'SHA1', 1: 'SHA1', 2: 'SHA256', 3: 'SHA512', 4: 'MD5',
};
const DIGITS_MAP: Record<number, number> = { 0: 6, 1: 6, 2: 8 };
const TYPE_MAP: Record<number, 'TOTP' | 'HOTP'> = { 0: 'TOTP', 1: 'HOTP', 2: 'TOTP' };

function parseMigrationPayload(buf: Buffer): OtpEntry[] {
  const out: OtpEntry[] = [];
  const r = new ProtoReader(buf);
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === 2) {
      out.push(parseOtpParameters(r.readBytes()));
    } else {
      r.skip(wireType);
    }
  }
  return out;
}

function parseOtpParameters(buf: Buffer): OtpEntry {
  const r = new ProtoReader(buf);
  let secret: Buffer = Buffer.alloc(0);
  let name = '';
  let issuer = '';
  let algorithm = 'SHA1';
  let digits = 6;
  let type: 'TOTP' | 'HOTP' = 'TOTP';
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === 2) secret = r.readBytes();
    else if (fieldNumber === 2 && wireType === 2) name = r.readBytes().toString('utf-8');
    else if (fieldNumber === 3 && wireType === 2) issuer = r.readBytes().toString('utf-8');
    else if (fieldNumber === 4 && wireType === 0) algorithm = ALG_MAP[Number(r.readVarint())] ?? 'SHA1';
    else if (fieldNumber === 5 && wireType === 0) digits = DIGITS_MAP[Number(r.readVarint())] ?? 6;
    else if (fieldNumber === 6 && wireType === 0) type = TYPE_MAP[Number(r.readVarint())] ?? 'TOTP';
    else r.skip(wireType);
  }
  if (type !== 'TOTP') {
    throw new Error(`only TOTP entries are supported (entry '${name || issuer}' is ${type})`);
  }

  // The migration payload's period is implicit (Google Authenticator always
  // assumes 30s for TOTP). Wrap everything into a real otpauth:// URI via
  // the library so we can store the canonical form.
  const totp = new OTPAuth.TOTP({
    issuer,
    label: name,
    algorithm,
    digits,
    period: 30,
    secret: OTPAuth.Secret.fromHex(secret.toString('hex')),
  });

  return {
    uri: totp.toString(),
    name,
    issuer,
    label: issuer ? `${issuer} (${name})` : (name || '<unnamed>'),
    algorithm,
    digits,
    period: 30,
  };
}

class ProtoReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}
  hasMore(): boolean { return this.offset < this.buf.length; }
  readTag() { const v = this.readVarint(); return { fieldNumber: Number(v >> 3n), wireType: Number(v & 7n) }; }
  readVarint(): bigint {
    let result = 0n; let shift = 0n;
    while (true) {
      if (this.offset >= this.buf.length) throw new Error('protobuf: unexpected end of buffer');
      const b = this.buf[this.offset++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
  }
  readBytes(): Buffer {
    const len = Number(this.readVarint());
    const out = Buffer.from(this.buf.subarray(this.offset, this.offset + len));
    this.offset += len;
    return out;
  }
  skip(wireType: number): void {
    if (wireType === 0) this.readVarint();
    else if (wireType === 2) this.readBytes();
    else if (wireType === 1) this.offset += 8;
    else if (wireType === 5) this.offset += 4;
    else throw new Error(`protobuf: unsupported wire type ${wireType}`);
  }
}
