import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { diagnose, heal, type HealResult } from '../core/heal.js';
import {
  isAgentInstalled,
  isAgentLoaded,
  installAgent,
  removeAgent,
  tailLog,
  getAgentPlistPath,
  getAgentLogPath,
} from '../core/launchagent.js';
import { getOccBinaryPath } from '../core/skhd.js';

interface Props {
  action?: string;
  silent?: boolean;
}

export function HealScreen({ action, silent }: Props) {
  switch (action) {
    case 'install':
      return <InstallAgentFlow />;
    case 'remove':
      return <RemoveAgentFlow />;
    case 'status':
      return <StatusFlow />;
    default:
      return <RunHeal silent={silent} />;
  }
}

function RunHeal({ silent }: { silent?: boolean }) {
  const { exit } = useApp();
  const [result, setResult] = useState<HealResult | null>(null);

  useEffect(() => {
    const r = heal();
    setResult(r);
    // Silent mode: only print when we actually did something, then exit.
    if (silent) {
      if (r.healed) {
        // eslint-disable-next-line no-console
        console.log(`occ heal: ${r.reason}`);
      }
      setTimeout(() => exit(), 20);
    } else {
      setTimeout(() => exit(), 100);
    }
  }, []);

  if (silent) return null;

  if (!result) {
    return <Text><Spinner type="dots" /> Checking for zombie DNS state...</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ heal</Text>
      </Box>
      {result.healed ? (
        <Text color="green">✓ {result.reason}</Text>
      ) : (
        <Text dimColor>{result.reason}</Text>
      )}
    </Box>
  );
}

type Phase = 'checking' | 'needs-occ-path' | 'installing' | 'removing' | 'done' | 'error';

function InstallAgentFlow() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('installing');
  const [error, setError] = useState('');

  useEffect(() => {
    const occPath = getOccBinaryPath();
    if (!occPath) {
      setError("Could not find 'occ' in PATH. Install it globally first (npm install -g @alexsarrell/occ).");
      setPhase('error');
      setTimeout(() => exit(), 200);
      return;
    }
    try {
      installAgent(occPath);
      setPhase('done');
      setTimeout(() => exit(), 200);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setPhase('error');
      setTimeout(() => exit(), 200);
    }
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ heal install</Text>
      </Box>
      {phase === 'installing' && <Text><Spinner type="dots" /> Installing LaunchAgent...</Text>}
      {phase === 'done' && (
        <Box flexDirection="column">
          <Text color="green">✓ LaunchAgent installed at {getAgentPlistPath()}</Text>
          <Text dimColor>It runs 'occ heal --silent' on every login/session start.</Text>
          <Text dimColor>Log: {getAgentLogPath()}</Text>
        </Box>
      )}
      {phase === 'error' && (
        <Box flexDirection="column">
          <Text color="red">✗ {error}</Text>
        </Box>
      )}
    </Box>
  );
}

function RemoveAgentFlow() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<'removing' | 'done' | 'not-installed' | 'error'>('removing');
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const removed = removeAgent();
      setPhase(removed ? 'done' : 'not-installed');
      setTimeout(() => exit(), 150);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setPhase('error');
      setTimeout(() => exit(), 200);
    }
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ heal remove</Text>
      </Box>
      {phase === 'removing' && <Text><Spinner type="dots" /> Removing LaunchAgent...</Text>}
      {phase === 'done' && <Text color="green">✓ LaunchAgent removed.</Text>}
      {phase === 'not-installed' && <Text color="yellow">LaunchAgent was not installed.</Text>}
      {phase === 'error' && <Text color="red">✗ {error}</Text>}
    </Box>
  );
}

function StatusFlow() {
  const { exit } = useApp();
  useEffect(() => {
    setTimeout(() => exit(), 100);
  }, []);

  const installed = isAgentInstalled();
  const loaded = installed ? isAgentLoaded() : false;
  const log = installed ? tailLog(10) : '';
  const d = diagnose();

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ heal status</Text>
      </Box>
      <Text>
        LaunchAgent:{' '}
        {installed ? (
          loaded ? <Text color="green">installed + loaded</Text> : <Text color="yellow">installed but not loaded</Text>
        ) : <Text dimColor>not installed</Text>}
      </Text>
      <Text>
        Current state:{' '}
        {d.previousDns && d.service ? (
          <Text color="yellow">zombie DNS on {d.service} ({d.previousDns.join(', ')})</Text>
        ) : (
          <Text color="green">clean</Text>
        )}
      </Text>
      {installed && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Recent log ({getAgentLogPath()}):</Text>
          <Text dimColor>{log || '(empty)'}</Text>
        </Box>
      )}
    </Box>
  );
}
