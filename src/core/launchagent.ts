import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AGENT_LABEL = 'com.alexsarrell.occ-heal';

export function getLaunchAgentsDir(): string {
  return join(homedir(), 'Library', 'LaunchAgents');
}

export function getAgentPlistPath(): string {
  return join(getLaunchAgentsDir(), `${AGENT_LABEL}.plist`);
}

export function getAgentLogPath(): string {
  return join(homedir(), '.occ', 'heal.log');
}

export function isAgentInstalled(): boolean {
  return existsSync(getAgentPlistPath());
}

export function isAgentLoaded(): boolean {
  try {
    const output = execFileSync('launchctl', ['list'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\n').some((line) => line.trim().endsWith(AGENT_LABEL));
  } catch {
    return false;
  }
}

/** Renders the plist XML. Baking in the absolute path to `occ` makes the
 *  agent robust to PATH not being set up for launchd. */
function renderPlist(occPath: string): string {
  const logPath = getAgentLogPath();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${occPath}</string>
        <string>heal</string>
        <string>--silent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
</dict>
</plist>
`;
}

/** Write the plist and load it via launchctl. */
export function installAgent(occPath: string): void {
  const dir = getLaunchAgentsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const logDir = join(homedir(), '.occ');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const path = getAgentPlistPath();
  writeFileSync(path, renderPlist(occPath));

  // Unload first (harmless if not loaded) then load fresh so changes take effect.
  try {
    execFileSync('launchctl', ['unload', path], { stdio: 'pipe' });
  } catch {
    // was not loaded — fine
  }
  execFileSync('launchctl', ['load', path], { stdio: 'pipe' });
}

/** Unload and delete the plist. */
export function removeAgent(): boolean {
  const path = getAgentPlistPath();
  if (!existsSync(path)) return false;
  try {
    execFileSync('launchctl', ['unload', path], { stdio: 'pipe' });
  } catch {
    // best effort
  }
  unlinkSync(path);
  return true;
}

export function tailLog(lines: number = 20): string {
  const path = getAgentLogPath();
  if (!existsSync(path)) return '(no log yet)';
  try {
    const content = readFileSync(path, 'utf-8');
    const split = content.split('\n');
    return split.slice(-lines).join('\n').trim() || '(log is empty)';
  } catch {
    return '(could not read log)';
  }
}
