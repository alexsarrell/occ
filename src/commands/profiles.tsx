import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { loadConfig, addProfile, updateProfile, deleteProfile, setDefaultProfile, getProfile } from '../config/store.js';
import { hasKeychainPassword, addKeychainPassword } from '../core/keychain.js';
import type { Profile } from '../config/types.js';

interface Props {
  action?: string;
  name?: string;
}

export function ProfilesScreen({ action, name }: Props) {
  switch (action) {
    case 'add':
      return <AddProfileFlow />;
    case 'edit':
      return <EditProfileFlow name={name} />;
    case 'delete':
      return <DeleteProfileFlow name={name} />;
    case 'default':
      return <SetDefaultFlow name={name} />;
    case 'list':
    default:
      return <ListProfiles />;
  }
}

function ListProfiles() {
  const { exit } = useApp();
  const config = loadConfig();

  useEffect(() => {
    setTimeout(() => exit(), 100);
  }, []);

  if (config.profiles.length === 0) {
    return <Text color="yellow">No profiles configured. Run: occ profiles add</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>VPN Profiles</Text>
      </Box>
      {config.profiles.map(p => (
        <Box key={p.name} gap={2}>
          <Text color={p.name === config.defaultProfile ? 'cyan' : undefined}>
            {p.name === config.defaultProfile ? '* ' : '  '}
            {p.name}
          </Text>
          <Text dimColor>{p.server}</Text>
          <Text dimColor>({p.username})</Text>
        </Box>
      ))}
    </Box>
  );
}

type AddStep = 'name' | 'server' | 'username' | 'keychainService' | 'keychain-check' | 'keychain-password' | 'done';

function AddProfileFlow() {
  const { exit } = useApp();
  const [step, setStep] = useState<AddStep>('name');
  const [name, setName] = useState('');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [keychainService, setKeychainService] = useState('openconnect');
  const [keychainPassword, setKeychainPassword] = useState('');
  const [error, setError] = useState('');

  const handleNameSubmit = (value: string) => {
    if (!value.trim()) { setError('Name cannot be empty'); return; }
    if (getProfile(value.trim())) { setError(`Profile '${value}' already exists`); return; }
    setError('');
    setName(value.trim());
    setStep('server');
  };

  const handleServerSubmit = (value: string) => {
    if (!value.trim()) { setError('Server cannot be empty'); return; }
    setError('');
    setServer(value.trim());
    setStep('username');
  };

  const handleUsernameSubmit = (value: string) => {
    if (!value.trim()) { setError('Username cannot be empty'); return; }
    setError('');
    setUsername(value.trim());
    setStep('keychainService');
  };

  const handleKeychainServiceSubmit = (value: string) => {
    const svc = value.trim() || 'openconnect';
    setKeychainService(svc);
    setStep('keychain-check');
  };

  // Check if password exists in Keychain
  useEffect(() => {
    if (step !== 'keychain-check') return;
    if (hasKeychainPassword(username, keychainService)) {
      saveAndFinish();
    } else {
      setStep('keychain-password');
    }
  }, [step]);

  const handleKeychainPasswordSubmit = (value: string) => {
    if (value.trim()) {
      try {
        addKeychainPassword(username, keychainService, value.trim());
      } catch (e: any) {
        setError(`Failed to save to Keychain: ${e.message}`);
        return;
      }
    }
    saveAndFinish();
  };

  const saveAndFinish = () => {
    try {
      addProfile({ name, server, username, keychainService });
      setStep('done');
      setTimeout(() => exit(), 100);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Add new profile</Text>
      </Box>

      {error && <Text color="red">{error}</Text>}

      {step === 'name' && (
        <Box>
          <Text>Profile name: </Text>
          <TextInput value={name} onChange={setName} onSubmit={handleNameSubmit} />
        </Box>
      )}

      {step === 'server' && (
        <Box>
          <Text>Server URL: </Text>
          <TextInput value={server} onChange={setServer} onSubmit={handleServerSubmit} />
        </Box>
      )}

      {step === 'username' && (
        <Box>
          <Text>Username: </Text>
          <TextInput value={username} onChange={setUsername} onSubmit={handleUsernameSubmit} />
        </Box>
      )}

      {step === 'keychainService' && (
        <Box flexDirection="column">
          <Text dimColor>Keychain service name (press Enter for "openconnect"):</Text>
          <Box>
            <Text>Keychain service: </Text>
            <TextInput value={keychainService} onChange={setKeychainService} onSubmit={handleKeychainServiceSubmit} />
          </Box>
        </Box>
      )}

      {step === 'keychain-password' && (
        <Box flexDirection="column">
          <Text color="yellow">Password not found in Keychain for '{username}' / '{keychainService}'.</Text>
          <Text dimColor>Enter password to save (or press Enter to skip):</Text>
          <Box>
            <Text>Password: </Text>
            <TextInput value={keychainPassword} onChange={setKeychainPassword} onSubmit={handleKeychainPasswordSubmit} mask="*" />
          </Box>
        </Box>
      )}

      {step === 'done' && (
        <Text color="green">Profile '{name}' created successfully.</Text>
      )}
    </Box>
  );
}

function EditProfileFlow({ name }: { name?: string }) {
  const { exit } = useApp();
  const [step, setStep] = useState<'select-field' | 'edit-value' | 'done'>('select-field');
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  if (!name) {
    return <Text color="red">Usage: occ profiles edit &lt;name&gt;</Text>;
  }

  const profile = getProfile(name);
  if (!profile) {
    return <Text color="red">Profile '{name}' not found</Text>;
  }

  const fields = [
    { label: `server (${profile.server})`, value: 'server' },
    { label: `username (${profile.username})`, value: 'username' },
    { label: `keychainService (${profile.keychainService})`, value: 'keychainService' },
  ];

  const handleFieldSelect = (item: { value: string }) => {
    setField(item.value);
    setValue((profile as any)[item.value] ?? '');
    setStep('edit-value');
  };

  const handleValueSubmit = (newValue: string) => {
    if (!newValue.trim()) { setError('Value cannot be empty'); return; }
    try {
      updateProfile(name, { [field]: newValue.trim() });
      setStep('done');
      setTimeout(() => exit(), 100);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Edit profile: {name}</Text>
      </Box>

      {error && <Text color="red">{error}</Text>}

      {step === 'select-field' && (
        <Box flexDirection="column">
          <Text>Select field to edit:</Text>
          <SelectInput items={fields} onSelect={handleFieldSelect} />
        </Box>
      )}

      {step === 'edit-value' && (
        <Box>
          <Text>{field}: </Text>
          <TextInput value={value} onChange={setValue} onSubmit={handleValueSubmit} />
        </Box>
      )}

      {step === 'done' && (
        <Text color="green">Profile '{name}' updated.</Text>
      )}
    </Box>
  );
}

function DeleteProfileFlow({ name }: { name?: string }) {
  const { exit } = useApp();
  const [confirmed, setConfirmed] = useState(false);

  if (!name) {
    return <Text color="red">Usage: occ profiles delete &lt;name&gt;</Text>;
  }

  const profile = getProfile(name);
  if (!profile) {
    return <Text color="red">Profile '{name}' not found</Text>;
  }

  const handleSelect = (item: { value: string }) => {
    if (item.value === 'yes') {
      deleteProfile(name);
      setConfirmed(true);
      setTimeout(() => exit(), 100);
    } else {
      exit();
    }
  };

  if (confirmed) {
    return <Text color="green">Profile '{name}' deleted.</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text>Delete profile '{name}' ({profile.server})? </Text>
      <SelectInput
        items={[
          { label: 'No, cancel', value: 'no' },
          { label: 'Yes, delete', value: 'yes' },
        ]}
        onSelect={handleSelect}
      />
    </Box>
  );
}

function SetDefaultFlow({ name }: { name?: string }) {
  const { exit } = useApp();

  useEffect(() => {
    setTimeout(() => exit(), 100);
  }, []);

  if (!name) {
    return <Text color="red">Usage: occ profiles default &lt;name&gt;</Text>;
  }

  try {
    setDefaultProfile(name);
    return <Text color="green">Default profile set to '{name}'.</Text>;
  } catch (e: any) {
    return <Text color="red">{e.message}</Text>;
  }
}
