import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Config, Profile } from './types.js';

const DEFAULT_CONFIG: Config = {
  profiles: [],
  defaultProfile: null,
};

export function getConfigDir(): string {
  return process.env.OCC_CONFIG_DIR ?? join(homedir(), '.occ');
}

function getConfigFile(): string {
  return join(getConfigDir(), 'profiles.json');
}

export function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function isFirstRun(): boolean {
  return !existsSync(getConfigFile());
}

export function loadConfig(): Config {
  const file = getConfigFile();
  if (!existsSync(file)) {
    return { ...DEFAULT_CONFIG, profiles: [] };
  }
  const raw = readFileSync(file, 'utf-8');
  return JSON.parse(raw) as Config;
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2) + '\n');
}

export function getProfile(name: string): Profile | undefined {
  return loadConfig().profiles.find(p => p.name === name);
}

export function getDefaultProfile(): Profile | undefined {
  const config = loadConfig();
  if (!config.defaultProfile) return undefined;
  return config.profiles.find(p => p.name === config.defaultProfile);
}

export function addProfile(profile: Profile): void {
  const config = loadConfig();
  if (config.profiles.some(p => p.name === profile.name)) {
    throw new Error(`Profile '${profile.name}' already exists`);
  }
  config.profiles.push(profile);
  if (config.profiles.length === 1) {
    config.defaultProfile = profile.name;
  }
  saveConfig(config);
}

export function updateProfile(name: string, updates: Partial<Omit<Profile, 'name'>>): void {
  const config = loadConfig();
  const index = config.profiles.findIndex(p => p.name === name);
  if (index === -1) {
    throw new Error(`Profile '${name}' not found`);
  }
  config.profiles[index] = { ...config.profiles[index], ...updates };
  saveConfig(config);
}

export function deleteProfile(name: string): void {
  const config = loadConfig();
  config.profiles = config.profiles.filter(p => p.name !== name);
  if (config.defaultProfile === name) {
    config.defaultProfile = config.profiles[0]?.name ?? null;
  }
  saveConfig(config);
}

export function setDefaultProfile(name: string): void {
  const config = loadConfig();
  if (!config.profiles.some(p => p.name === name)) {
    throw new Error(`Profile '${name}' not found`);
  }
  config.defaultProfile = name;
  saveConfig(config);
}
