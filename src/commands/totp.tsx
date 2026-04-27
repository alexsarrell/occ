import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { loadConfig, updateProfile } from '../config/store.js';
import { addKeychainPassword, deleteKeychainPassword, getKeychainPassword } from '../core/keychain.js';
import { base32Encode, generate, parseMigrationUrl, secondsRemaining, type OtpEntry } from '../core/totp.js';

void React;

interface Props {
  action?: string;
  arg1?: string;
  arg2?: string;
}

export function TotpScreen({ action, arg1, arg2 }: Props) {
  switch (action) {
    case 'import':
      return <ImportFlow url={arg1} />;
    case 'link':
      return <LinkFlow profileName={arg1} service={arg2} />;
    case 'unlink':
      return <UnlinkFlow profileName={arg1} />;
    case 'forget':
      return <ForgetFlow service={arg1} />;
    case 'show':
      return <ShowFlow profileName={arg1} />;
    case 'list':
    default:
      return <ListFlow />;
  }
}

function ListFlow() {
  const { exit } = useApp();
  const config = loadConfig();
  useEffect(() => { setTimeout(() => exit(), 50); }, []);

  const linked = config.profiles.filter(p => p.totpKeychainService);
  if (linked.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No profiles have TOTP configured.</Text>
        <Text dimColor>Run: occ totp import "otpauth-migration://..."</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold>TOTP-linked profiles</Text>
      {linked.map(p => (
        <Box key={p.name} gap={2}>
          <Text color="cyan">  {p.name}</Text>
          <Text dimColor>service={p.totpKeychainService}</Text>
          <Text dimColor>account={p.username}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ---------- import ----------

type ImportStep = 'enter-url' | 'pick-entry' | 'pick-service' | 'pick-profiles' | 'saving' | 'done' | 'error';

function ImportFlow({ url }: { url?: string }) {
  const { exit } = useApp();
  const [step, setStep] = useState<ImportStep>(url ? 'pick-entry' : 'enter-url');
  const [urlInput, setUrlInput] = useState('');
  const [entries, setEntries] = useState<OtpEntry[]>([]);
  const [entryIdx, setEntryIdx] = useState(0);
  const [chosenEntry, setChosenEntry] = useState<OtpEntry | null>(null);
  const [serviceName, setServiceName] = useState('');
  const [profilesToAttach, setProfilesToAttach] = useState<Set<string>>(new Set());
  const [profileCursor, setProfileCursor] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const allProfiles = useMemo(() => loadConfig().profiles, []);

  // If URL was provided up-front, parse it on mount.
  useEffect(() => {
    if (!url) return;
    try {
      const list = parseMigrationUrl(url);
      if (list.length === 0) {
        setError('No OTP entries found in the migration URL.');
        setStep('error');
        return;
      }
      setEntries(list);
    } catch (e: any) {
      setError(`Failed to parse migration URL: ${e.message}`);
      setStep('error');
    }
  }, [url]);

  const handleUrlSubmit = (value: string) => {
    setError('');
    try {
      const list = parseMigrationUrl(value.trim());
      if (list.length === 0) {
        setError('No OTP entries found in the migration URL.');
        return;
      }
      setEntries(list);
      setStep('pick-entry');
    } catch (e: any) {
      setError(`Failed to parse migration URL: ${e.message}`);
    }
  };

  // Pick-entry: arrow keys + enter.
  useInput((input, key) => {
    if (step === 'pick-entry') {
      if (key.upArrow) setEntryIdx(i => Math.max(0, i - 1));
      else if (key.downArrow) setEntryIdx(i => Math.min(entries.length - 1, i + 1));
      else if (key.return) {
        const e = entries[entryIdx];
        setChosenEntry(e);
        // Default service name derived from issuer if available, else "occ-totp".
        const slug = (e.issuer || 'occ-totp').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        setServiceName(slug ? `occ-totp-${slug}` : 'occ-totp');
        setStep('pick-service');
      }
    } else if (step === 'pick-profiles') {
      if (allProfiles.length === 0) return;
      if (key.upArrow) setProfileCursor(c => Math.max(0, c - 1));
      else if (key.downArrow) setProfileCursor(c => Math.min(allProfiles.length - 1, c + 1));
      else if (input === ' ') {
        const name = allProfiles[profileCursor].name;
        const next = new Set(profilesToAttach);
        next.has(name) ? next.delete(name) : next.add(name);
        setProfilesToAttach(next);
      } else if (key.return) {
        save();
      }
    }
  });

  const handleServiceSubmit = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setServiceName(v);
    setStep('pick-profiles');
  };

  const save = () => {
    if (!chosenEntry) return;
    setStep('saving');
    try {
      const account = chosenEntry.name.includes(':')
        ? chosenEntry.name.split(':')[0]
        : chosenEntry.name;
      const secretB32 = base32Encode(chosenEntry.secret);
      addKeychainPassword(account, serviceName, secretB32);
      const attached: string[] = [];
      for (const profileName of profilesToAttach) {
        // Update profile to point at the keychain service. Account = profile.username
        // (we keep one secret per service, account is the profile's VPN user).
        updateProfile(profileName, { totpKeychainService: serviceName });
        attached.push(profileName);
      }
      const code = generate(secretB32);
      let msg = `Saved to Keychain (service=${serviceName}, account=${account}).\n`;
      if (attached.length) {
        msg += `Linked to profile${attached.length > 1 ? 's' : ''}: ${attached.join(', ')}.\n`;
      } else {
        msg += `No profiles linked. Run: occ totp link <profile> ${serviceName}\n`;
      }
      msg += `Current code: ${code} (refreshes in ${secondsRemaining()}s)`;
      setMessage(msg);
      setStep('done');
      setTimeout(() => exit(), 50);
    } catch (e: any) {
      setError(`Save failed: ${e.message}`);
      setStep('error');
      setTimeout(() => exit(), 50);
    }
  };

  if (step === 'enter-url') {
    return (
      <Box flexDirection="column">
        <Text bold>Paste otpauth-migration:// URL (from Google Authenticator export QR):</Text>
        <TextInput value={urlInput} onChange={setUrlInput} onSubmit={handleUrlSubmit} />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === 'pick-entry') {
    return (
      <Box flexDirection="column">
        <Text bold>Found {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}. Pick one (↑/↓, Enter):</Text>
        {entries.map((e, i) => (
          <Text key={i} color={i === entryIdx ? 'cyan' : undefined}>
            {i === entryIdx ? '> ' : '  '}{e.label}
          </Text>
        ))}
      </Box>
    );
  }

  if (step === 'pick-service') {
    return (
      <Box flexDirection="column">
        <Text bold>Keychain service name:</Text>
        <Text dimColor>(profiles will reference this name; press Enter to accept default)</Text>
        <TextInput value={serviceName} onChange={setServiceName} onSubmit={handleServiceSubmit} />
      </Box>
    );
  }

  if (step === 'pick-profiles') {
    if (allProfiles.length === 0) {
      // Save the secret anyway, with no profile attached.
      setTimeout(save, 0);
      return <Text>No profiles to attach to — saving secret only…</Text>;
    }
    return (
      <Box flexDirection="column">
        <Text bold>Attach to profiles (Space toggles, Enter confirms):</Text>
        {allProfiles.map((p, i) => {
          const checked = profilesToAttach.has(p.name);
          return (
            <Text key={p.name} color={i === profileCursor ? 'cyan' : undefined}>
              {i === profileCursor ? '>' : ' '} [{checked ? 'x' : ' '}] {p.name}
              {p.totpKeychainService ? ` (currently: ${p.totpKeychainService})` : ''}
            </Text>
          );
        })}
        <Text dimColor>Selected: {profilesToAttach.size}</Text>
      </Box>
    );
  }

  if (step === 'saving') return <Text>Saving…</Text>;
  if (step === 'done') return <Text color="green">{message}</Text>;
  return <Text color="red">{error}</Text>;
}

// ---------- link / unlink / forget / show ----------

function LinkFlow({ profileName, service }: { profileName?: string; service?: string }) {
  const { exit } = useApp();
  useEffect(() => { setTimeout(() => exit(), 50); }, []);
  if (!profileName || !service) {
    return <Text color="red">Usage: occ totp link &lt;profile&gt; &lt;keychain-service&gt;</Text>;
  }
  const config = loadConfig();
  const profile = config.profiles.find(p => p.name === profileName);
  if (!profile) return <Text color="red">Profile '{profileName}' not found.</Text>;
  // Verify the secret is actually present in Keychain so we don't link to nothing.
  try {
    getKeychainPassword(profile.username, service);
  } catch {
    return (
      <Box flexDirection="column">
        <Text color="red">No secret found in Keychain for service='{service}', account='{profile.username}'.</Text>
        <Text dimColor>Run 'occ totp import' first or check the service name.</Text>
      </Box>
    );
  }
  updateProfile(profileName, { totpKeychainService: service });
  return <Text color="green">Linked profile '{profileName}' → service '{service}'.</Text>;
}

function UnlinkFlow({ profileName }: { profileName?: string }) {
  const { exit } = useApp();
  useEffect(() => { setTimeout(() => exit(), 50); }, []);
  if (!profileName) return <Text color="red">Usage: occ totp unlink &lt;profile&gt;</Text>;
  const profile = loadConfig().profiles.find(p => p.name === profileName);
  if (!profile) return <Text color="red">Profile '{profileName}' not found.</Text>;
  if (!profile.totpKeychainService) return <Text color="yellow">Profile '{profileName}' has no TOTP linked.</Text>;
  updateProfile(profileName, { totpKeychainService: undefined });
  return <Text color="green">Unlinked profile '{profileName}'. Keychain secret left intact (other profiles may use it).</Text>;
}

function ForgetFlow({ service }: { service?: string }) {
  const { exit } = useApp();
  useEffect(() => { setTimeout(() => exit(), 50); }, []);
  if (!service) return <Text color="red">Usage: occ totp forget &lt;keychain-service&gt;</Text>;
  const config = loadConfig();
  const stillUsed = config.profiles.filter(p => p.totpKeychainService === service);
  if (stillUsed.length > 0) {
    return (
      <Box flexDirection="column">
        <Text color="red">Cannot forget: still linked to profiles: {stillUsed.map(p => p.name).join(', ')}.</Text>
        <Text dimColor>Run 'occ totp unlink &lt;profile&gt;' first.</Text>
      </Box>
    );
  }
  // We don't know the account name without a profile reference. Try every
  // profile's username as a candidate account; delete each that exists.
  const accounts = Array.from(new Set(config.profiles.map(p => p.username)));
  let deleted = 0;
  for (const acc of accounts) {
    try {
      deleteKeychainPassword(acc, service);
      deleted++;
    } catch {
      // not present for this account, skip
    }
  }
  if (deleted === 0) {
    return <Text color="yellow">Nothing matched in Keychain for service '{service}'.</Text>;
  }
  return <Text color="green">Removed {deleted} entr{deleted === 1 ? 'y' : 'ies'} from Keychain for service '{service}'.</Text>;
}

function ShowFlow({ profileName }: { profileName?: string }) {
  const { exit } = useApp();
  useEffect(() => { setTimeout(() => exit(), 50); }, []);
  if (!profileName) return <Text color="red">Usage: occ totp show &lt;profile&gt;</Text>;
  const profile = loadConfig().profiles.find(p => p.name === profileName);
  if (!profile) return <Text color="red">Profile '{profileName}' not found.</Text>;
  if (!profile.totpKeychainService) return <Text color="yellow">Profile '{profileName}' has no TOTP linked.</Text>;
  let secret: string;
  try {
    secret = getKeychainPassword(profile.username, profile.totpKeychainService);
  } catch (e: any) {
    return <Text color="red">{e.message}</Text>;
  }
  const code = generate(secret);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{code}</Text>
      <Text dimColor>refreshes in {secondsRemaining()}s</Text>
    </Box>
  );
}
