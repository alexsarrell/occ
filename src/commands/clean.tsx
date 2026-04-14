import React, { useState } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { resetDnsInteractive, flushRoutes, getActiveInterface, getServiceName } from '../core/dns.js';

export function CleanScreen({ full }: { full?: boolean }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done' | 'error'>('confirm');
  const [error, setError] = useState('');

  const handleSelect = (item: { value: string }) => {
    if (item.value === 'no') {
      exit();
      return;
    }

    setPhase('running');

    // Exit Ink to let sudo prompt work with inherited stdio
    setTimeout(() => {
      exit();
      try {
        resetDnsInteractive();
        if (full) {
          flushRoutes();
        }
        console.log('\x1b[32mDNS reset complete.\x1b[0m');
      } catch (e: any) {
        console.error(`\x1b[31mError: ${e.message}\x1b[0m`);
        process.exit(1);
      }
    }, 50);
  };

  const iface = getActiveInterface();
  const service = iface ? getServiceName(iface) : null;

  if (phase === 'confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold>occ clean</Text>
        </Box>
        <Text>This will reset DNS settings{service ? ` for '${service}'` : ''} to DHCP defaults.</Text>
        {full && <Text color="yellow">--full: Will also flush the routing table.</Text>}
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: 'Yes, reset DNS', value: 'yes' },
              { label: 'Cancel', value: 'no' },
            ]}
            onSelect={handleSelect}
          />
        </Box>
      </Box>
    );
  }

  return null;
}
