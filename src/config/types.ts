export interface Profile {
  name: string;
  server: string;
  username: string;
  keychainService: string;
  noDtls?: boolean;
  reconnectTimeout?: number;
}

export interface Config {
  profiles: Profile[];
  defaultProfile: string | null;
}
