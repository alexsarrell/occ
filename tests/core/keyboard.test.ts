import { describe, it, expect } from 'vitest';
import { normalizeKey } from '../../src/core/keyboard.js';

describe('normalizeKey', () => {
  it('returns lowercased Latin chars unchanged', () => {
    expect(normalizeKey('q')).toBe('q');
    expect(normalizeKey('Q')).toBe('q');
    expect(normalizeKey('r')).toBe('r');
  });

  it('maps Russian aliases for our shortcut keys', () => {
    expect(normalizeKey('й')).toBe('q');
    expect(normalizeKey('Й')).toBe('q');
    expect(normalizeKey('к')).toBe('r');
    expect(normalizeKey('К')).toBe('r');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeKey('')).toBe('');
  });

  it('passes through unknown chars lowercased', () => {
    expect(normalizeKey('а')).toBe('а'); // not a shortcut → not aliased
    expect(normalizeKey('1')).toBe('1');
    expect(normalizeKey('!')).toBe('!');
    expect(normalizeKey('日')).toBe('日');
  });
});
