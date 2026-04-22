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
}

export interface Config {
  profiles: Profile[];
  defaultProfile: string | null;
}
