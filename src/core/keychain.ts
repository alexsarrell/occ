import { execFileSync } from 'node:child_process';

export function getKeychainPassword(account: string, service: string): string {
  try {
    const password = execFileSync('/usr/bin/security', [
      'find-generic-password', '-a', account, '-s', service, '-w',
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    if (!password) {
      throw new Error('empty');
    }
    return password;
  } catch {
    throw new Error(
      `Password for '${account}' not found in Keychain service '${service}'. ` +
      `Use 'occ profiles edit' to configure or run: ` +
      `security add-generic-password -a "${account}" -s "${service}" -w`
    );
  }
}

export function addKeychainPassword(account: string, service: string, password: string): void {
  execFileSync('/usr/bin/security', [
    'add-generic-password', '-a', account, '-s', service, '-w', password,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
}

export function hasKeychainPassword(account: string, service: string): boolean {
  try {
    getKeychainPassword(account, service);
    return true;
  } catch {
    return false;
  }
}

export function deleteKeychainPassword(account: string, service: string): void {
  execFileSync('/usr/bin/security', [
    'delete-generic-password', '-a', account, '-s', service,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
}
