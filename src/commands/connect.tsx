import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { OpenConnectManager } from '../core/openconnect.js';
import { getKeychainPassword } from '../core/keychain.js';
import { startCaffeinate, stopCaffeinate } from '../core/caffeinate.js';
import { resetDns } from '../core/dns.js';
import { getProfile, getDefaultProfile } from '../config/store.js';
import { StatusBadge } from '../components/StatusBadge.js';
import type { Profile } from '../config/types.js';
import { execFileSync } from 'node:child_process';

type Phase = 'resolving' | 'starting' | 'sudo' | 'authenticating' | 'otp' | 'connected' | 'reconnecting' | 'failed';

const CONNECTION_TIMEOUT_MS = 90_000;

export function ConnectScreen({ profileName }: { profileName?: string }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('resolving');
  const [error, setError] = useState('');
  const [sudoPassword, setSudoPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const managerRef = useRef<OpenConnectManager | null>(null);
  const phaseRef = useRef<Phase>('resolving');
  phaseRef.current = phase;

  // Resolve profile and check if already connected
  useEffect(() => {
    // Check if VPN is already running
    try {
      execFileSync('pgrep', ['openconnect'], { stdio: 'pipe' });
      setError("VPN is already connected. Run 'occ stop' first.");
      setPhase('failed');
      return;
    } catch {
      // Not running — good
    }

    const resolved = profileName ? getProfile(profileName) : getDefaultProfile();
    if (!resolved) {
      const msg = profileName
        ? `Profile '${profileName}' not found. Run 'occ profiles list' to see available profiles.`
        : `No default profile configured. Run 'occ profiles add' to create one.`;
      setError(msg);
      setPhase('failed');
      return;
    }
    setProfile(resolved);
    setPhase('starting');
  }, [profileName]);

  // Start connection once profile is resolved
  useEffect(() => {
    if (!profile || phase !== 'starting') return;

    const manager = new OpenConnectManager();
    managerRef.current = manager;

    const cleanup = () => {
      manager.disconnect();
      stopCaffeinate();
      resetDns();
    };

    // Signal handlers for graceful shutdown on Ctrl+C / kill
    const handleSignal = () => {
      cleanup();
      process.exit(0);
    };
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    // Connection timeout (90s)
    const timeout = setTimeout(() => {
      if (phaseRef.current !== 'connected') {
        setError('Connection timed out (90s)');
        setPhase('failed');
        manager.disconnect();
      }
    }, CONNECTION_TIMEOUT_MS);

    manager.on('state', (state, message) => {
      switch (state) {
        case 'waiting-sudo':
          setPhase('sudo');
          break;
        case 'authenticating':
          try {
            const pw = getKeychainPassword(profile.username, profile.keychainService);
            manager.sendInput(pw);
            setPhase('authenticating');
          } catch (e: any) {
            setError(e.message);
            setPhase('failed');
            manager.disconnect();
          }
          break;
        case 'waiting-otp':
          setPhase('otp');
          break;
        case 'connected':
          clearTimeout(timeout);
          setPhase('connected');
          startCaffeinate();
          break;
        case 'reconnecting':
          setPhase('reconnecting');
          break;
        case 'failed':
          clearTimeout(timeout);
          setError(message ?? 'Connection failed');
          setPhase('failed');
          break;
        case 'disconnected':
          clearTimeout(timeout);
          stopCaffeinate();
          resetDns();
          exit();
          break;
      }
    });

    manager.connect(profile);

    return () => {
      clearTimeout(timeout);
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      cleanup();
    };
  }, [profile, phase]);

  // Handle q to disconnect in connected state
  useInput((input) => {
    if (input === 'q' && (phase === 'connected' || phase === 'reconnecting')) {
      managerRef.current?.disconnect();
    }
  });

  const handleSudoSubmit = (value: string) => {
    managerRef.current?.sendInput(value);
    setSudoPassword('');
    setPhase('authenticating');
  };

  const handleOtpSubmit = (value: string) => {
    managerRef.current?.sendInput(value);
    setOtpCode('');
    setPhase('authenticating');
  };

  return (
    <Box flexDirection="column" padding={1}>
      {profile && (
        <Box marginBottom={1}>
          <Text bold>occ</Text>
          <Text> ~ </Text>
          <Text bold color="cyan">{profile.name}</Text>
          <Text dimColor> ({profile.server})</Text>
        </Box>
      )}

      {phase === 'resolving' && (
        <Text><Spinner type="dots" /> Resolving profile...</Text>
      )}

      {phase === 'starting' && (
        <Text><Spinner type="dots" /> Starting OpenConnect...</Text>
      )}

      {phase === 'sudo' && (
        <Box flexDirection="column">
          <Text>Enter sudo password:</Text>
          <TextInput
            value={sudoPassword}
            onChange={setSudoPassword}
            onSubmit={handleSudoSubmit}
            mask="*"
          />
        </Box>
      )}

      {phase === 'authenticating' && (
        <Text><Spinner type="dots" /> Authenticating...</Text>
      )}

      {phase === 'otp' && (
        <Box flexDirection="column">
          <Text>Enter OTP code:</Text>
          <TextInput
            value={otpCode}
            onChange={setOtpCode}
            onSubmit={handleOtpSubmit}
          />
        </Box>
      )}

      {phase === 'reconnecting' && (
        <Box flexDirection="column">
          <Box>
            <StatusBadge status="connecting" />
            <Text> Reconnecting to {profile!.name}...</Text>
          </Box>
          <Text dimColor>Press q to disconnect</Text>
        </Box>
      )}

      {phase === 'connected' && (
        <Box flexDirection="column">
          <Box>
            <StatusBadge status="connected" />
            <Text> {profile!.name}</Text>
          </Box>
          <Text dimColor>Press q to disconnect</Text>
        </Box>
      )}

      {phase === 'failed' && (
        <Box flexDirection="column">
          <Box>
            <StatusBadge status="failed" />
            <Text> {error}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
