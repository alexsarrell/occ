import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import {
  isTouchIdEnabled,
  readSudoLocal,
  computeEnabledContent,
  computeDisabledContent,
  writeSudoLocal,
  hasTouchIdHardware,
  sudoLocalPath,
} from '../core/touchid.js';

interface Props {
  action?: string;
}

export function TouchIdScreen({ action }: Props) {
  switch (action) {
    case 'enable':
      return <EnableFlow />;
    case 'disable':
      return <DisableFlow />;
    case 'status':
    default:
      return <StatusFlow />;
  }
}

function StatusFlow() {
  const { exit } = useApp();
  useEffect(() => {
    setTimeout(() => exit(), 100);
  }, []);

  const enabled = isTouchIdEnabled();
  const hasHw = hasTouchIdHardware();

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ touchid status</Text>
      </Box>
      <Text>
        Touch ID hardware: {hasHw ? <Text color="green">present</Text> : <Text color="yellow">not detected</Text>}
      </Text>
      <Text>
        Touch ID for sudo:{' '}
        {enabled ? <Text color="green">enabled</Text> : <Text dimColor>disabled</Text>}
      </Text>
      <Text dimColor>Config: {sudoLocalPath()}</Text>
      {!enabled && (
        <Box marginTop={1}>
          <Text>Run <Text bold>occ touchid enable</Text> to turn it on.</Text>
        </Box>
      )}
    </Box>
  );
}

type Phase = 'confirm' | 'writing' | 'done' | 'already' | 'error';

function EnableFlow() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('confirm');

  if (!hasTouchIdHardware() && phase === 'confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>occ touchid enable</Text>
        <Text color="yellow">No Touch ID sensor detected on this machine.</Text>
        <Text dimColor>You can still enable pam_tid.so but it won't do anything useful.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: 'Cancel', value: 'cancel' },
              { label: 'Enable anyway', value: 'ok' },
            ]}
            onSelect={(i) => {
              if (i.value === 'cancel') exit();
              else performEnable();
            }}
          />
        </Box>
      </Box>
    );
  }

  const performEnable = () => {
    const existing = readSudoLocal();
    const { changed, next } = computeEnabledContent(existing);
    if (!changed) {
      setPhase('already');
      setTimeout(() => exit(), 150);
      return;
    }
    setPhase('writing');
    // Exit Ink so sudo prompt can render normally (password or Touch ID UI).
    setTimeout(() => {
      exit();
      try {
        writeSudoLocal(next);
        console.log('\x1b[32m✓ Touch ID for sudo enabled.\x1b[0m');
        console.log('Touch your sensor the next time sudo asks for a password.');
      } catch (e: any) {
        console.error(`\x1b[31m✗ Failed to write ${sudoLocalPath()}: ${e.message ?? e}\x1b[0m`);
        process.exit(1);
      }
    }, 50);
  };

  if (phase === 'confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold>occ touchid enable</Text>
        </Box>
        <Text>This will add <Text color="cyan">pam_tid.so</Text> to {sudoLocalPath()}</Text>
        <Text dimColor>(requires sudo — prompts once for password)</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: 'Enable Touch ID for sudo', value: 'ok' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onSelect={(i) => {
              if (i.value === 'cancel') exit();
              else performEnable();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === 'writing') {
    return <Text><Spinner type="dots" /> Writing config (sudo will prompt)...</Text>;
  }

  if (phase === 'already') {
    return <Text color="green">✓ Touch ID is already enabled for sudo — nothing to do.</Text>;
  }

  return null;
}

function DisableFlow() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('confirm');

  const performDisable = () => {
    const existing = readSudoLocal();
    const { changed, next } = computeDisabledContent(existing);
    if (!changed || next == null) {
      setPhase('already');
      setTimeout(() => exit(), 150);
      return;
    }
    setPhase('writing');
    setTimeout(() => {
      exit();
      try {
        writeSudoLocal(next);
        console.log('\x1b[32m✓ Touch ID for sudo disabled.\x1b[0m');
      } catch (e: any) {
        console.error(`\x1b[31m✗ Failed to write ${sudoLocalPath()}: ${e.message ?? e}\x1b[0m`);
        process.exit(1);
      }
    }, 50);
  };

  if (phase === 'confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold>occ touchid disable</Text>
        </Box>
        <Text>This will comment out the pam_tid.so line in {sudoLocalPath()}</Text>
        <Text dimColor>You'll be back to typing your sudo password.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: 'Cancel', value: 'cancel' },
              { label: 'Disable Touch ID for sudo', value: 'ok' },
            ]}
            onSelect={(i) => {
              if (i.value === 'cancel') exit();
              else performDisable();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === 'writing') {
    return <Text><Spinner type="dots" /> Writing config (sudo will prompt)...</Text>;
  }

  if (phase === 'already') {
    return <Text color="yellow">Touch ID was not enabled — nothing to do.</Text>;
  }

  return null;
}
