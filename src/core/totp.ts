import { createHmac } from 'node:crypto';

/**
 * TOTP per RFC 6238 with SHA-1, 6 digits, 30-second period — the defaults
 * used by Google Authenticator and the vast majority of TOTP deployments.
 * If we ever encounter SHA-256/SHA-512 or 8-digit codes, the migration
 * payload exposes that and we can extend `generate()` to honor it.
 */

export interface OtpEntry {
  /** Raw HMAC key bytes (binary). */
  secret: Buffer;
  /** Account label, e.g. "a.popov@vpn-sls.just-ai.com" or just "a.popov". */
  name: string;
  /** Issuer/service, e.g. "just-ai" or "VPN". May be empty. */
  issuer: string;
  /** Display string combining issuer + name for UI. */
  label: string;
}

const STEP_SECONDS = 30;
const DIGITS = 6;

export function generate(secretBase32: string, atUnix: number = Date.now() / 1000): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(atUnix / STEP_SECONDS);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Seconds remaining in the current 30-second window (for UI hints). */
export function secondsRemaining(atUnix: number = Date.now() / 1000): number {
  return STEP_SECONDS - Math.floor(atUnix) % STEP_SECONDS;
}

// ---------- base32 (RFC 4648, uppercase, no padding) ----------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  // Strip whitespace, padding, lowercase.
  const cleaned = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------- otpauth-migration protobuf parser ----------

/**
 * Parse `otpauth-migration://offline?data=<urlsafe-base64>` into a list of
 * accounts. Used by `occ totp import` to read a Google Authenticator export QR.
 */
export function parseMigrationUrl(url: string): OtpEntry[] {
  const u = new URL(url);
  if (u.protocol !== 'otpauth-migration:') {
    throw new Error(`expected otpauth-migration:// URL, got ${u.protocol}`);
  }
  const data = u.searchParams.get('data');
  if (!data) {
    throw new Error('migration URL has no `data` param');
  }
  // URL-encoded base64 (may contain + / =, which URL spec encodes).
  const decoded = decodeURIComponent(data);
  // Google Authenticator uses standard base64 (with + and /), not urlsafe.
  const buf = Buffer.from(decoded, 'base64');
  return parseMigrationPayload(buf);
}

/**
 * Minimal protobuf decoder for the MigrationPayload message:
 *
 *   message MigrationPayload {
 *     repeated OtpParameters otp_parameters = 1;
 *     int32 version = 2;
 *     int32 batch_size = 3;
 *     int32 batch_index = 4;
 *     int32 batch_id = 5;
 *   }
 *
 *   message OtpParameters {
 *     bytes secret = 1;
 *     string name = 2;
 *     string issuer = 3;
 *     Algorithm algorithm = 4;   // 1=SHA1
 *     DigitCount digits = 5;     // 1=SIX, 2=EIGHT
 *     OtpType type = 6;          // 1=HOTP, 2=TOTP
 *     int64 counter = 7;
 *   }
 *
 * We only handle TOTP/SHA1/6-digit (which is what Google Authenticator emits
 * for nearly every real-world site). Extending to other algorithms is a few
 * lines if it's ever needed.
 */
function parseMigrationPayload(buf: Buffer): OtpEntry[] {
  const entries: OtpEntry[] = [];
  const reader = new ProtoReader(buf);
  while (reader.hasMore()) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1 && wireType === 2) {
      const otpBuf = reader.readBytes();
      entries.push(parseOtpParameters(otpBuf));
    } else {
      reader.skip(wireType);
    }
  }
  return entries;
}

function parseOtpParameters(buf: Buffer): OtpEntry {
  const reader = new ProtoReader(buf);
  let secret: Buffer = Buffer.alloc(0);
  let name = '';
  let issuer = '';
  while (reader.hasMore()) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1 && wireType === 2) secret = reader.readBytes();
    else if (fieldNumber === 2 && wireType === 2) name = reader.readBytes().toString('utf-8');
    else if (fieldNumber === 3 && wireType === 2) issuer = reader.readBytes().toString('utf-8');
    else reader.skip(wireType);
  }
  const label = issuer ? `${issuer} (${name})` : name || '<unnamed>';
  return { secret, name, issuer, label };
}

class ProtoReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  hasMore(): boolean {
    return this.offset < this.buf.length;
  }

  readTag(): { fieldNumber: number; wireType: number } {
    const v = this.readVarint();
    return { fieldNumber: Number(v >> 3n), wireType: Number(v & 7n) };
  }

  readVarint(): bigint {
    let result = 0n;
    let shift = 0n;
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
