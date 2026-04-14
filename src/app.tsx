import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { loadConfig, isFirstRun, ensureConfigDir } from './config/store.js';
import { runAllChecks } from './config/doctor.js';
import { ConnectScreen } from './commands/connect.js';
import { ProfilesScreen } from './commands/profiles.js';
import { DoctorScreen } from './commands/doctor.js';
import type { DoctorCheck } from './config/doctor.js';
import type { Profile } from './config/types.js';

type Screen = 'menu' | 'connect' | 'profiles-add' | 'doctor' | 'first-run-doctor' | 'first-run-add';

export function App() {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(isFirstRun() ? 'first-run-doctor' : 'menu');
  const [connectProfile, setConnectProfile] = useState<string | undefined>(undefined);

  // First-run: doctor check
  if (screen === 'first-run-doctor') {
    return <FirstRunDoctor onComplete={(ok) => {
      if (ok) {
        ensureConfigDir();
        setScreen('first-run-add');
      } else {
        exit();
      }
    }} />;
  }

  if (screen === 'first-run-add') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Welcome to occ!</Text>
          <Text> Let's set up your first VPN profile.</Text>
        </Box>
        <ProfilesScreen action="add" />
      </Box>
    );
  }

  if (screen === 'connect') {
    return <ConnectScreen profileName={connectProfile} />;
  }

  if (screen === 'profiles-add') {
    return <ProfilesScreen action="add" />;
  }

  if (screen === 'doctor') {
    return <DoctorScreen />;
  }

  // Main menu
  const config = loadConfig();
  const items = [
    ...config.profiles.map(p => ({
      label: `${p.name === config.defaultProfile ? '● ' : '  '}${p.name}  ${p.server}`,
      value: `profile:${p.name}`,
    })),
    ...(config.profiles.length > 0 ? [{ label: '─────────────', value: 'separator' }] : []),
    { label: '+ New profile', value: 'new' },
    { label: '⚕ Doctor', value: 'doctor' },
    { label: '✕ Quit', value: 'quit' },
  ];

  // Find default profile index for initial focus
  const defaultIndex = config.profiles.findIndex(p => p.name === config.defaultProfile);

  const handleSelect = (item: { value: string }) => {
    if (item.value === 'separator') return;
    if (item.value === 'quit') { exit(); return; }
    if (item.value === 'new') { setScreen('profiles-add'); return; }
    if (item.value === 'doctor') { setScreen('doctor'); return; }
    if (item.value.startsWith('profile:')) {
      const profileName = item.value.slice('profile:'.length);
      setConnectProfile(profileName);
      setScreen('connect');
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ</Text>
        <Text> — OpenConnect VPN</Text>
      </Box>
      <SelectInput
        items={items}
        initialIndex={Math.max(0, defaultIndex)}
        onSelect={handleSelect}
      />
    </Box>
  );
}

function FirstRunDoctor({ onComplete }: { onComplete: (ok: boolean) => void }) {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);

  useEffect(() => {
    runAllChecks().then((results) => {
      setChecks(results);
      const allOk = results.every((c) => c.status === 'ok');
      setTimeout(() => onComplete(allOk), allOk ? 500 : 0);
    });
  }, []);

  if (!checks) {
    return (
      <Box padding={1}>
        <Text><Spinner type="dots" /> Checking dependencies...</Text>
      </Box>
    );
  }

  const allOk = checks.every(c => c.status === 'ok');

  return (
    <Box flexDirection="column" padding={1}>
      {checks.map(check => (
        <Box key={check.name} gap={1}>
          <Text>{check.status === 'ok' ? '✓' : '✗'}</Text>
          <Text color={check.status === 'ok' ? 'green' : 'red'}>{check.name}</Text>
          <Text dimColor>— {check.message}</Text>
          {check.fix && <Text color="yellow"> Fix: {check.fix}</Text>}
        </Box>
      ))}
      {allOk && (
        <Box marginTop={1}>
          <Text color="green">All good!</Text>
        </Box>
      )}
      {!allOk && (
        <Box marginTop={1}>
          <Text color="red">Fix the issues above, then run occ again.</Text>
        </Box>
      )}
    </Box>
  );
}
