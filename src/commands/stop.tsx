import React, { useState, useEffect } from 'react';
import { Text, useApp } from 'ink';
import { execFileSync } from 'node:child_process';

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
        setResult({ success: true, message: 'VPN disconnected' });
      }
    } catch {
      setResult({ success: false, message: 'VPN is not running' });
    }

    // Exit after a short delay to let Ink render
    setTimeout(() => exit(), 100);
  }, []);

  if (!result) return null;

  return (
    <Text color={result.success ? 'green' : 'yellow'}>
      {result.message}
    </Text>
  );
}
