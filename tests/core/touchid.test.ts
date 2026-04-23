import { describe, it, expect } from 'vitest';
import { computeEnabledContent, computeDisabledContent } from '../../src/core/touchid.js';

describe('computeEnabledContent (without pam_reattach)', () => {
  it('creates a fresh file when none exists', () => {
    const r = computeEnabledContent(null);
    expect(r.changed).toBe(true);
    expect(r.next).toMatch(/^auth\s+sufficient\s+pam_tid\.so\s*$/m);
    expect(r.next).not.toMatch(/pam_reattach/);
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

describe('computeEnabledContent (with pam_reattach)', () => {
  const reattach = '/opt/homebrew/lib/pam/pam_reattach.so';

  it('fresh file includes both reattach and pam_tid in order', () => {
    const r = computeEnabledContent(null, reattach);
    expect(r.changed).toBe(true);
    const reattachIdx = r.next.indexOf('pam_reattach');
    const pamTidIdx = r.next.indexOf('pam_tid');
    expect(reattachIdx).toBeGreaterThan(-1);
    expect(pamTidIdx).toBeGreaterThan(-1);
    expect(reattachIdx).toBeLessThan(pamTidIdx);
  });

  it('inserts reattach before existing uncommented pam_tid', () => {
    const existing = 'auth       sufficient     pam_tid.so\n';
    const r = computeEnabledContent(existing, reattach);
    expect(r.changed).toBe(true);
    const reattachIdx = r.next.indexOf('pam_reattach');
    const pamTidIdx = r.next.indexOf('pam_tid');
    expect(reattachIdx).toBeLessThan(pamTidIdx);
  });

  it('no-op when both reattach and pam_tid already configured', () => {
    const existing = `auth       optional       ${reattach}\nauth       sufficient     pam_tid.so\n`;
    const r = computeEnabledContent(existing, reattach);
    expect(r.changed).toBe(false);
  });

  it('accepts any pam_reattach install path as satisfying', () => {
    const existing = `auth       optional       /usr/local/lib/pam/pam_reattach.so\nauth       sufficient     pam_tid.so\n`;
    // Even though we pass Apple Silicon path, the existing Intel path counts.
    const r = computeEnabledContent(existing, reattach);
    expect(r.changed).toBe(false);
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
