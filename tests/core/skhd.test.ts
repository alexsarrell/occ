import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getManagedHotkeys,
  writeManagedHotkeys,
  removeManagedBlock,
  buildDefaultHotkeys,
} from '../../src/core/skhd.js';

// The module uses homedir() internally. We shim HOME to a temp dir for tests.
let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'occ-skhd-test-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
});

describe('getManagedHotkeys', () => {
  it('returns empty array when config does not exist', () => {
    expect(getManagedHotkeys()).toEqual([]);
  });

  it('returns empty array when managed block is absent', () => {
    mkdirSync(join(tempHome, '.config', 'skhd'), { recursive: true });
    const configPath = join(tempHome, '.config', 'skhd', 'skhdrc');
    writeFileSync(configPath, 'cmd - a : echo a\n');
    expect(getManagedHotkeys()).toEqual([]);
  });
});

describe('writeManagedHotkeys + removeManagedBlock', () => {
  it('writes block to a fresh config', () => {
    const hotkeys = [
      { key: 'cmd + shift - v', command: 'occ', description: 'Menu' },
    ];
    writeManagedHotkeys(hotkeys);
    const read = getManagedHotkeys();
    expect(read).toHaveLength(1);
    expect(read[0].key).toBe('cmd + shift - v');
    expect(read[0].command).toBe('occ');
    expect(read[0].description).toBe('Menu');
  });

  it('preserves user bindings outside managed block', () => {
    mkdirSync(join(tempHome, '.config', 'skhd'), { recursive: true });
    const configPath = join(tempHome, '.config', 'skhd', 'skhdrc');
    writeFileSync(configPath, '# My own binding\ncmd + alt - t : open -a Terminal\n');

    writeManagedHotkeys([
      { key: 'cmd + shift - v', command: 'occ', description: 'Menu' },
    ]);

    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('cmd + alt - t : open -a Terminal');
    expect(content).toContain('cmd + shift - v : occ');
  });

  it('replaces existing managed block on re-run', () => {
    writeManagedHotkeys([
      { key: 'cmd - a', command: 'old', description: 'old' },
    ]);
    writeManagedHotkeys([
      { key: 'cmd - b', command: 'new', description: 'new' },
    ]);

    const hotkeys = getManagedHotkeys();
    expect(hotkeys).toHaveLength(1);
    expect(hotkeys[0].key).toBe('cmd - b');
    expect(hotkeys[0].command).toBe('new');
  });

  it('removeManagedBlock leaves user bindings intact', () => {
    mkdirSync(join(tempHome, '.config', 'skhd'), { recursive: true });
    const configPath = join(tempHome, '.config', 'skhd', 'skhdrc');
    writeFileSync(configPath, '# User\ncmd + alt - t : open -a Terminal\n');

    writeManagedHotkeys([
      { key: 'cmd + shift - v', command: 'occ', description: 'Menu' },
    ]);
    const removed = removeManagedBlock();
    expect(removed).toBe(true);

    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('cmd + alt - t : open -a Terminal');
    expect(content).not.toContain('BEGIN occ-managed');
    expect(content).not.toContain('cmd + shift - v');
  });

  it('removeManagedBlock returns false when no block exists', () => {
    expect(removeManagedBlock()).toBe(false);
  });
});

describe('buildDefaultHotkeys', () => {
  it('includes three default bindings with the occ path baked in', () => {
    const hotkeys = buildDefaultHotkeys('/opt/homebrew/bin/occ');
    expect(hotkeys).toHaveLength(3);
    expect(hotkeys[0].key).toBe('cmd + ctrl + alt - v');
    expect(hotkeys[1].key).toBe('cmd + ctrl + alt - c');
    expect(hotkeys[2].key).toBe('cmd + ctrl + alt - d');
    expect(hotkeys[0].command).toContain('/opt/homebrew/bin/occ');
    expect(hotkeys[1].command).toContain('/opt/homebrew/bin/occ connect');
    expect(hotkeys[2].command).toContain('/opt/homebrew/bin/occ stop');
  });
});
