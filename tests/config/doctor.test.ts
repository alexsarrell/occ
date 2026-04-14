import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkOpenConnect, checkConfigDir } from '../../src/config/doctor.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('checkOpenConnect', () => {
  it('returns ok or missing based on system state', () => {
    const result = checkOpenConnect();
    expect(result.name).toBe('openconnect');
    expect(['ok', 'missing']).toContain(result.status);
    if (result.status === 'missing') {
      expect(result.fix).toBe('brew install openconnect');
    }
  });
});

describe('checkConfigDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'occ-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OCC_CONFIG_DIR;
  });

  it('returns ok for existing directory', () => {
    process.env.OCC_CONFIG_DIR = tempDir;
    const result = checkConfigDir();
    expect(result.status).toBe('ok');
  });

  it('returns ok for non-existing directory (parent writable)', () => {
    process.env.OCC_CONFIG_DIR = join(tempDir, 'occ-nonexistent');
    const result = checkConfigDir();
    expect(result.status).toBe('ok');
  });
});
