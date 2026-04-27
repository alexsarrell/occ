import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { OpenConnectManager } from '../core/openconnect.js';
import { getKeychainPassword } from '../core/keychain.js';
import { generate as generateTotp } from '../core/totp.js';
import { startCaffeinate, stopCaffeinate } from '../core/caffeinate.js';
import { resetDns } from '../core/dns.js';
import { getProfile, getDefaultProfile } from '../config/store.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { LogsFooter } from '../components/LogsFooter.js';
import { normalizeKey } from '../core/keyboard.js';
import { isTouchIdEnabled } from '../core/touchid.js';
import type { Profile } from '../config/types.js';
import { execFileSync } from 'node:child_process';

type Phase = 'resolving' | 'starting' | 'sudo' | 'authenticating' | 'otp' | 'connected' | 'reconnecting' | 'failed';

const CONNECTION_TIMEOUT_MS = 90_000;
const STUCK_RECONNECT_SOFT_MS = 30_000; // SIGUSR2
const STUCK_RECONNECT_HARD_MS = 90_000; // surface to user

export function ConnectScreen({ profileName }: { profileName?: string }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('resolving');
  const [error, setError] = useState('');
  const [sudoPassword, setSudoPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsVisible, setLogsVisible] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [logsScrollOffset, setLogsScrollOffset] = useState(0);
  const [reconnectHint, setReconnectHint] = useState(false);
  const managerRef = useRef<OpenConnectManager | null>(null);
  const phaseRef = useRef<Phase>('resolving');
  const reconnectEnteredAt = useRef<number | null>(null);
  const softRetriedRef = useRef(false);
  phaseRef.current = phase;

  // Resolve profile and check if already connected
  useEffect(() => {
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
    if (!profile) return;

    const manager = new OpenConnectManager();
    managerRef.current = manager;

    const cleanup = () => {
      manager.disconnect();
      stopCaffeinate();
      resetDns();
    };

    const handleSignal = () => {
      cleanup();
      process.exit(0);
    };
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    process.on('SIGHUP', handleSignal);

    const timeout = setTimeout(() => {
      if (phaseRef.current !== 'connected') {
        setError('Connection timed out (90s)');
        setPhase('failed');
        manager.disconnect();
      }
    }, CONNECTION_TIMEOUT_MS);

    const sendKeychainPassword = () => {
      try {
        const pw = getKeychainPassword(profile.username, profile.keychainService);
        manager.sendInput(pw);
        setPhase('authenticating');
      } catch (e: any) {
        setError(e.message);
        setPhase('failed');
        manager.disconnect();
      }
    };

    manager.on('state', (state, message) => {
      switch (state) {
        case 'waiting-sudo':
          // Standalone sudo auth pty. Only the sudo password goes here.
          setPhase('sudo');
          break;
        case 'authenticating':
          // Openconnect pty asking for VPN password — send from Keychain.
          sendKeychainPassword();
          break;
        case 'waiting-otp':
          // If the profile has a TOTP secret in Keychain, generate the code and
          // send it automatically. Fall through to the manual prompt only if the
          // secret is missing or unreadable — that way a misconfigured profile
          // still lets the user type a code by hand instead of hanging.
          if (profile.totpKeychainService) {
            try {
              const secret = getKeychainPassword(profile.username, profile.totpKeychainService);
              manager.sendInput(generateTotp(secret));
              setPhase('authenticating');
              break;
            } catch {
              // fall through to manual entry
            }
          }
          setPhase('otp');
          break;
        case 'connected':
          clearTimeout(timeout);
          reconnectEnteredAt.current = null;
          softRetriedRef.current = false;
          setReconnectHint(false);
          setPhase('connected');
          startCaffeinate();
          break;
        case 'reconnecting':
          if (phaseRef.current !== 'reconnecting') {
            reconnectEnteredAt.current = Date.now();
            softRetriedRef.current = false;
            setReconnectHint(false);
          }
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

    // Live log updates — throttle to max 5 updates/sec for smooth rendering
    let pending = false;
    manager.on('log', () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        setLogs(manager.getLogs());
      }, 200);
    });

    manager.connect(profile);

    return () => {
      clearTimeout(timeout);
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      process.off('SIGHUP', handleSignal);
      cleanup();
    };
  }, [profile]);

  // Watchdog for stuck reconnects
  useEffect(() => {
    if (phase !== 'reconnecting') return;
    const interval = setInterval(() => {
      if (!reconnectEnteredAt.current) return;
      const stuckFor = Date.now() - reconnectEnteredAt.current;

      if (!softRetriedRef.current && stuckFor > STUCK_RECONNECT_SOFT_MS) {
        softRetriedRef.current = true;
        managerRef.current?.reconnect();
      } else if (stuckFor > STUCK_RECONNECT_HARD_MS) {
        setReconnectHint(true);
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, [phase]);

  // Hide logs whenever an interactive prompt is shown (sudo / otp)
  useEffect(() => {
    if (phase === 'sudo' || phase === 'otp') {
      setLogsVisible(false);
      setLogsExpanded(false);
    }
  }, [phase]);

  const canShowLogs = phase !== 'resolving' && phase !== 'sudo' && phase !== 'otp';

  useInput((input, key) => {
    // Tab toggles logs visibility (only useful in non-input phases)
    if (key.tab && canShowLogs) {
      if (logsVisible) {
        setLogsVisible(false);
        setLogsExpanded(false);
        setLogsScrollOffset(0);
      } else {
        setLogsVisible(true);
      }
      return;
    }

    if (logsVisible) {
      if (key.escape) {
        setLogsVisible(false);
        setLogsExpanded(false);
        setLogsScrollOffset(0);
        return;
      }
      if (key.return) {
        setLogsExpanded((e) => !e);
        if (logsExpanded) setLogsScrollOffset(0);
        return;
      }
      if (logsExpanded) {
        if (key.upArrow) {
          setLogsScrollOffset((o) => Math.min(logs.length, o + 1));
          return;
        }
        if (key.downArrow) {
          setLogsScrollOffset((o) => Math.max(0, o - 1));
          return;
        }
        if (key.pageUp) {
          setLogsScrollOffset((o) => Math.min(logs.length, o + 10));
          return;
        }
        if (key.pageDown) {
          setLogsScrollOffset((o) => Math.max(0, o - 10));
          return;
        }
      }
      // Logs focused — swallow other keys
      return;
    }

    // Main panel focused (no logs visible)
    // Esc — universal disconnect (layout-independent control char)
    if (key.escape && (phase === 'connected' || phase === 'reconnecting')) {
      managerRef.current?.disconnect();
      return;
    }
    // q / r — normalized to handle non-Latin layouts
    const ch = normalizeKey(input);
    if (ch === 'q' && (phase === 'connected' || phase === 'reconnecting')) {
      managerRef.current?.disconnect();
    }
    if (ch === 'r' && phase === 'reconnecting' && reconnectHint) {
      managerRef.current?.disconnect();
    }
  });

  const handleSudoSubmit = (value: string) => {
    managerRef.current?.sendInput(value);
    setSudoPassword('');
    // Transition to a spinner while sudo verifies. Manager will emit
    // 'authenticating' once openconnect begins prompting for the VPN password.
    setPhase('authenticating');
  };

  const handleOtpSubmit = (value: string) => {
    managerRef.current?.sendInput(value);
    setOtpCode('');
    setPhase('authenticating');
  };

  const renderHints = () => {
    if (!canShowLogs) return null;
    const parts: string[] = [];
    if (phase === 'connected' || phase === 'reconnecting') parts.push('q/Esc disconnect');
    if (phase === 'reconnecting' && reconnectHint) parts.push('r force restart');
    if (!logsVisible) parts.push('Tab logs');
    if (parts.length === 0) return null;
    return <Text dimColor>{parts.join(' · ')}</Text>;
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
          {isTouchIdEnabled() && <Text dimColor>(or touch the sensor)</Text>}
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
          {reconnectHint && (
            <Text color="yellow">Reconnect is taking a while. Press r to force restart (will require re-auth)</Text>
          )}
        </Box>
      )}

      {phase === 'connected' && (
        <Box>
          <StatusBadge status="connected" />
          <Text> {profile!.name}</Text>
        </Box>
      )}

      {phase === 'failed' && (
        <Box>
          <StatusBadge status="failed" />
          <Text> {error}</Text>
        </Box>
      )}

      {renderHints()}

      {logsVisible && canShowLogs && (
        <LogsFooter
          logs={logs}
          expanded={logsExpanded}
          scrollOffset={logsScrollOffset}
        />
      )}
    </Box>
  );
}
