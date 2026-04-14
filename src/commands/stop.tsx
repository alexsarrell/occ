import React, { useState, useEffect } from 'react';
import { Text, useApp } from 'ink';
import { execFileSync } from 'node:child_process';
import { stopOrphanedCaffeinate } from '../core/caffeinate.js';
import { resetDns } from '../core/dns.js';

export function StopScreen() {
  const { exit } = useApp();
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    try {
      const pids = execFileSync('pgrep', ['openconnect'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split('\n').filter(Boolean);

      if (pids.length === 0) {
        setResult({ success: false, message: 'VPN is not running' });
      } else {
        for (const pid of pids) {
          process.kill(Number(pid), 'SIGTERM');
        }
        stopOrphanedCaffeinate();
        resetDns();
        setResult({ success: true, message: 'VPN disconnected' });
      }
    } catch {
      setResult({ success: false, message: 'VPN is not running' });
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
