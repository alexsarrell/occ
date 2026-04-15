import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import {
  isSkhdInstalled,
  installSkhdViaBrew,
  startSkhdService,
  restartSkhdService,
  ensureConfigExists,
  getManagedHotkeys,
  writeManagedHotkeys,
  removeManagedBlock,
  buildDefaultHotkeys,
  getOccBinaryPath,
  getSkhdConfigPath,
  openAccessibilitySettings,
} from '../core/skhd.js';

interface Props {
  action?: string;
}

export function HotkeysScreen({ action }: Props) {
  switch (action) {
    case 'install':
      return <InstallFlow />;
    case 'remove':
      return <RemoveFlow />;
    case 'list':
    default:
      return <ListHotkeys />;
  }
}

function ListHotkeys() {
  const { exit } = useApp();

  useEffect(() => {
    setTimeout(() => exit(), 100);
  }, []);

  if (!isSkhdInstalled()) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">skhd is not installed.</Text>
        <Text dimColor>Run: occ hotkeys install</Text>
      </Box>
    );
  }

  const hotkeys = getManagedHotkeys();

  if (hotkeys.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">No occ-managed hotkeys configured.</Text>
        <Text dimColor>Run: occ hotkeys install</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ hotkeys</Text>
      </Box>
      {hotkeys.map((hk, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold color="cyan">{hk.key}</Text>
            {hk.description && <Text dimColor>  — {hk.description}</Text>}
          </Box>
          <Text dimColor>  {hk.command}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Config: {getSkhdConfigPath()}</Text>
      </Box>
    </Box>
  );
}

type InstallPhase =
  | 'checking'
  | 'needs-brew-install'
  | 'installing-skhd'
  | 'writing-config'
  | 'done'
  | 'error';

function InstallFlow() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<InstallPhase>('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    if (phase !== 'checking') return;
    if (isSkhdInstalled()) {
      setPhase('writing-config');
    } else {
      setPhase('needs-brew-install');
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'writing-config') return;
    try {
      const occPath = getOccBinaryPath();
      if (!occPath) {
        setError("Could not find 'occ' in PATH. Is it installed globally?");
        setPhase('error');
        return;
      }
      ensureConfigExists();
      const hotkeys = buildDefaultHotkeys(occPath);
      writeManagedHotkeys(hotkeys);
      startSkhdService();
      restartSkhdService();
      setPhase('done');
      // Open Accessibility settings so user can grant permission
      openAccessibilitySettings();
      setTimeout(() => exit(), 200);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setPhase('error');
    }
  }, [phase]);

  const handleBrewChoice = (item: { value: string }) => {
    if (item.value === 'no') {
      exit();
      return;
    }
    setPhase('installing-skhd');
    // Defer to next tick so Ink can render "installing" state
    setTimeout(() => {
      try {
        installSkhdViaBrew();
        setPhase('writing-config');
      } catch (e: any) {
        setError(`brew install failed: ${e.message ?? e}`);
        setPhase('error');
      }
    }, 50);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ hotkeys install</Text>
      </Box>

      {phase === 'checking' && (
        <Text><Spinner type="dots" /> Checking for skhd...</Text>
      )}

      {phase === 'needs-brew-install' && (
        <Box flexDirection="column">
          <Text color="yellow">skhd is not installed.</Text>
          <Text dimColor>
            skhd is a tiny, open-source hotkey daemon for macOS
            (https://github.com/koekeishiya/skhd).
          </Text>
          <Box marginTop={1}>
            <Text>Install via `brew install koekeishiya/formulae/skhd`?</Text>
          </Box>
          <SelectInput
            items={[
              { label: 'Yes, install skhd', value: 'yes' },
              { label: 'Cancel', value: 'no' },
            ]}
            onSelect={handleBrewChoice}
          />
        </Box>
      )}

      {phase === 'installing-skhd' && (
        <Text><Spinner type="dots" /> Installing skhd via brew (may take a moment)...</Text>
      )}

      {phase === 'writing-config' && (
        <Text><Spinner type="dots" /> Writing skhd config...</Text>
      )}

      {phase === 'done' && (
        <Box flexDirection="column">
          <Text color="green" bold>✓ Hotkeys installed.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>Default bindings:</Text>
            <Text>  <Text color="cyan">⌘⇧V</Text>  — Open occ interactive menu</Text>
            <Text>  <Text color="cyan">⌘⇧C</Text>  — Connect to default profile</Text>
            <Text>  <Text color="cyan">⌘⇧D</Text>  — Disconnect VPN</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow" bold>One-time step required:</Text>
            <Text>System Settings will open now. Go to </Text>
            <Text dimColor>  Privacy & Security → Accessibility</Text>
            <Text>and enable <Text bold>skhd</Text> in the list.</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Edit or remove later: occ hotkeys remove / occ hotkeys list</Text>
          </Box>
        </Box>
      )}

      {phase === 'error' && (
        <Box flexDirection="column">
          <Text color="red" bold>✗ Install failed</Text>
          <Text color="red">{error}</Text>
        </Box>
      )}
    </Box>
  );
}

function RemoveFlow() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<'confirm' | 'removing' | 'done' | 'error'>('confirm');
  const [error, setError] = useState('');

  const handleChoice = (item: { value: string }) => {
    if (item.value === 'no') {
      exit();
      return;
    }
    setPhase('removing');
    try {
      const removed = removeManagedBlock();
      if (removed) {
        restartSkhdService();
      }
      setPhase('done');
      setTimeout(() => exit(), 100);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setPhase('error');
    }
  };

  const currentHotkeys = isSkhdInstalled() ? getManagedHotkeys() : [];

  if (phase === 'confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold>occ hotkeys remove</Text>
        </Box>
        {currentHotkeys.length === 0 ? (
          <Text color="yellow">No occ-managed hotkeys to remove.</Text>
        ) : (
          <>
            <Text>This will remove {currentHotkeys.length} managed hotkey{currentHotkeys.length === 1 ? '' : 's'} from skhd config.</Text>
            <Text dimColor>Other hotkeys in your skhdrc are left untouched. skhd itself stays installed.</Text>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: 'Yes, remove', value: 'yes' },
                  { label: 'Cancel', value: 'no' },
                ]}
                onSelect={handleChoice}
              />
            </Box>
          </>
        )}
      </Box>
    );
  }

  if (phase === 'removing') {
    return <Text><Spinner type="dots" /> Removing hotkeys...</Text>;
  }

  if (phase === 'done') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green" bold>✓ Hotkeys removed.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="red" bold>✗ Failed to remove hotkeys</Text>
      <Text color="red">{error}</Text>
    </Box>
  );
}
