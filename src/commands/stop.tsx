import React, { useState, useEffect } from 'react';
import { Text, useApp } from 'ink';
import { execFileSync } from 'node:child_process';
import { stopOrphanedCaffeinate } from '../core/caffeinate.js';
import { resetDns } from '../core/dns.js';

export function StopScreen() {
  const { exit } = useApp();
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    // pgrep first — distinguishes "not running" from "running but can't kill".
    let pids: string[] = [];
    try {
      pids = execFileSync('pgrep', ['openconnect'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split('\n').filter(Boolean);
    } catch {
      // pgrep exits 1 when no match — that's the only way we get here.
      setResult({ success: false, message: 'VPN is not running' });
      setTimeout(() => exit(), 100);
      return;
    }

    if (pids.length === 0) {
      setResult({ success: false, message: 'VPN is not running' });
      setTimeout(() => exit(), 100);
      return;
    }

    // openconnect runs as root (sudo), so process.kill from a normal user
    // returns EPERM. Use `sudo -n pkill` — passwordless if sudo's still cached
    // from a recent connect, otherwise it errors and we tell the user to
    // re-auth. Avoids killing other openconnect instances by using -SIGTERM.
    try {
      execFileSync('sudo', ['-n', 'pkill', '-TERM', 'openconnect'], { stdio: 'pipe' });
      stopOrphanedCaffeinate();
      resetDns();
      setResult({ success: true, message: 'VPN disconnected' });
    } catch {
      setResult({
        success: false,
        message: `Found openconnect (PID ${pids.join(', ')}) but couldn't kill it — sudo credentials expired.\nRun: sudo pkill openconnect`,
      });
    }
    setTimeout(() => exit(), 100);
  }, []);

  if (!result) return null;

  return (
    <Text color={result.success ? 'green' : 'yellow'}>
      {result.message}
    </Text>
  );
}
