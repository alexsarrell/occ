import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  saveConfig,
  addProfile,
  getProfile,
  getDefaultProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
  isFirstRun,
} from '../../src/config/store.js';
import type { Profile } from '../../src/config/types.js';

let tempDir: string;

const testProfile: Profile = {
  name: 'test-vpn',
  server: 'https://vpn.example.com',
  username: 'testuser',
  keychainService: 'openconnect',
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'occ-test-'));
  process.env.OCC_CONFIG_DIR = tempDir;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.OCC_CONFIG_DIR;
});

describe('isFirstRun', () => {
  it('returns true when config does not exist', () => {
    expect(isFirstRun()).toBe(true);
  });

  it('returns false after saving config', () => {
    saveConfig({ profiles: [], defaultProfile: null });
    expect(isFirstRun()).toBe(false);
  });
});

describe('loadConfig', () => {
  it('returns empty config when file does not exist', () => {
    const config = loadConfig();
    expect(config.profiles).toEqual([]);
    expect(config.defaultProfile).toBeNull();
  });

  it('returns saved config', () => {
    saveConfig({ profiles: [testProfile], defaultProfile: 'test-vpn' });
    const config = loadConfig();
    expect(config.profiles).toHaveLength(1);
    expect(config.profiles[0].name).toBe('test-vpn');
    expect(config.defaultProfile).toBe('test-vpn');
  });
});

describe('addProfile', () => {
  it('adds a profile and sets it as default if first', () => {
    addProfile(testProfile);
    const config = loadConfig();
    expect(config.profiles).toHaveLength(1);
    expect(config.defaultProfile).toBe('test-vpn');
  });

  it('does not change default when adding second profile', () => {
    addProfile(testProfile);
    addProfile({ ...testProfile, name: 'second' });
    const config = loadConfig();
    expect(config.profiles).toHaveLength(2);
    expect(config.defaultProfile).toBe('test-vpn');
  });

  it('throws on duplicate name', () => {
    addProfile(testProfile);
    expect(() => addProfile(testProfile)).toThrow("Profile 'test-vpn' already exists");
  });
});

describe('getProfile', () => {
  it('returns profile by name', () => {
    addProfile(testProfile);
    expect(getProfile('test-vpn')).toEqual(testProfile);
  });

  it('returns undefined for missing profile', () => {
    expect(getProfile('nope')).toBeUndefined();
  });
});

describe('getDefaultProfile', () => {
  it('returns undefined when no profiles', () => {
    expect(getDefaultProfile()).toBeUndefined();
  });

  it('returns the default profile', () => {
    addProfile(testProfile);
    expect(getDefaultProfile()?.name).toBe('test-vpn');
  });
});

describe('updateProfile', () => {
  it('updates profile fields', () => {
    addProfile(testProfile);
    updateProfile('test-vpn', { server: 'https://new.example.com' });
    expect(getProfile('test-vpn')?.server).toBe('https://new.example.com');
  });

  it('throws for missing profile', () => {
    expect(() => updateProfile('nope', { server: 'x' })).toThrow("Profile 'nope' not found");
  });
});

describe('deleteProfile', () => {
  it('removes the profile', () => {
    addProfile(testProfile);
    deleteProfile('test-vpn');
    expect(loadConfig().profiles).toHaveLength(0);
  });

  it('resets default when deleting default profile', () => {
    addProfile(testProfile);
    addProfile({ ...testProfile, name: 'second' });
    deleteProfile('test-vpn');
    expect(loadConfig().defaultProfile).toBe('second');
  });

  it('sets default to null when deleting last profile', () => {
    addProfile(testProfile);
    deleteProfile('test-vpn');
    expect(loadConfig().defaultProfile).toBeNull();
  });
});

describe('setDefaultProfile', () => {
  it('changes the default', () => {
    addProfile(testProfile);
    addProfile({ ...testProfile, name: 'second' });
    setDefaultProfile('second');
    expect(loadConfig().defaultProfile).toBe('second');
  });

  it('throws for missing profile', () => {
    expect(() => setDefaultProfile('nope')).toThrow("Profile 'nope' not found");
  });
});
