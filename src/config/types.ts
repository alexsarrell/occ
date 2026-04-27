export interface Profile {
  name: string;
  server: string;
  username: string;
  keychainService: string;
  noDtls?: boolean;
  reconnectTimeout?: number;
  /**
   * When true, fall back to openconnect's default vpnc-script instead of our
   * bundled split-DNS script. Enable this only if the VPN server requires
   * persistent DNS overrides (e.g. zero-trust networks that validate DNS).
   * Default: false — use our script.
   */
  useDefaultScript?: boolean;
  /**
   * Keychain service name where the TOTP base32 secret is stored. The account
   * is `username`. When set, `occ connect` reads the secret on OTP prompt and
   * auto-fills the code instead of asking the user. Multiple profiles may
   * point at the same service to share one secret.
   */
  totpKeychainService?: string;
}

export interface Config {
  profiles: Profile[];
  defaultProfile: string | null;
}
