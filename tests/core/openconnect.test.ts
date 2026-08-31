import { describe, it, expect } from 'vitest';
import {
  buildOpenconnectArgs,
  PERSISTENT_RECONNECT_TIMEOUT_SECONDS,
} from '../../src/core/openconnect.js';
import type { Profile } from '../../src/config/types.js';

describe('buildOpenconnectArgs', () => {
  const profile: Profile = {
    name: 'work',
    server: 'https://vpn.example.com',
    username: 'alex',
    keychainService: 'openconnect',
  };

  it('retries for the lifetime of occ by default', () => {
    expect(buildOpenconnectArgs(profile)).toContain(
      `--reconnect-timeout=${PERSISTENT_RECONNECT_TIMEOUT_SECONDS}`,
    );
  });

  it('preserves an explicitly configured finite reconnect timeout', () => {
    expect(buildOpenconnectArgs({ ...profile, reconnectTimeout: 900 })).toContain(
      '--reconnect-timeout=900',
    );
  });
});
