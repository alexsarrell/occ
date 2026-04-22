import { describe, it, expect } from 'vitest';
import { computeEnabledContent, computeDisabledContent } from '../../src/core/touchid.js';

describe('computeEnabledContent', () => {
  it('creates a fresh file when none exists', () => {
    const r = computeEnabledContent(null);
    expect(r.changed).toBe(true);
    expect(r.next).toMatch(/^auth\s+sufficient\s+pam_tid\.so\s*$/m);
  });

  it('does nothing when pam_tid is already uncommented', () => {
    const existing = 'auth       sufficient     pam_tid.so\n';
    const r = computeEnabledContent(existing);
    expect(r.changed).toBe(false);
    expect(r.next).toBe(existing);
  });

  it('uncomments the existing commented line (template format)', () => {
    const existing = [
      '# sudo_local: local config file which survives system update',
      '# uncomment following line to enable Touch ID for sudo',
      '#auth       sufficient     pam_tid.so',
      '',
    ].join('\n');
    const r = computeEnabledContent(existing);
    expect(r.changed).toBe(true);
    expect(r.next).toMatch(/^auth\s+sufficient\s+pam_tid\.so\s*$/m);
    expect(r.next).not.toMatch(/^#\s*auth\s+sufficient\s+pam_tid\.so/m);
  });

  it('appends when file has other content but no pam_tid line', () => {
    const existing = 'auth required pam_othermod.so\n';
    const r = computeEnabledContent(existing);
    expect(r.changed).toBe(true);
    expect(r.next).toContain('auth required pam_othermod.so');
    expect(r.next).toMatch(/^auth\s+sufficient\s+pam_tid\.so\s*$/m);
  });

  it('preserves indentation when uncommenting', () => {
    const existing = '    #auth       sufficient     pam_tid.so\n';
    const r = computeEnabledContent(existing);
    expect(r.changed).toBe(true);
    expect(r.next).toMatch(/^    auth\s+sufficient\s+pam_tid\.so/m);
  });
});

describe('computeDisabledContent', () => {
  it('returns no-change when file does not exist', () => {
    const r = computeDisabledContent(null);
    expect(r.changed).toBe(false);
    expect(r.next).toBeNull();
  });

  it('returns no-change when pam_tid is already commented out', () => {
    const existing = '#auth       sufficient     pam_tid.so\n';
    const r = computeDisabledContent(existing);
    expect(r.changed).toBe(false);
  });

  it('comments out an active pam_tid line', () => {
    const existing = 'auth       sufficient     pam_tid.so\n';
    const r = computeDisabledContent(existing);
    expect(r.changed).toBe(true);
    expect(r.next).toMatch(/^#auth\s+sufficient\s+pam_tid\.so/m);
  });

  it('preserves surrounding content', () => {
    const existing = [
      '# comment line',
      'auth       sufficient     pam_tid.so',
      'auth required pam_othermod.so',
      '',
    ].join('\n');
    const r = computeDisabledContent(existing);
    expect(r.changed).toBe(true);
    expect(r.next).toContain('# comment line');
    expect(r.next).toContain('auth required pam_othermod.so');
    expect(r.next).toMatch(/^#auth\s+sufficient\s+pam_tid\.so/m);
  });
});
