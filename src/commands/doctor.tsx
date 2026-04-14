import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { runAllChecks, type DoctorCheck } from '../config/doctor.js';

export function DoctorScreen() {
  const { exit } = useApp();
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);

  useEffect(() => {
    runAllChecks().then((results) => {
      setChecks(results);
      setTimeout(() => exit(), 100);
    });
  }, []);

  if (!checks) {
    return <Text><Spinner type="dots" /> Running diagnostics...</Text>;
  }

  const allOk = checks.every(c => c.status === 'ok');

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>occ doctor</Text>
      </Box>

      {checks.map(check => (
        <Box key={check.name} gap={1}>
          <Text>
            {check.status === 'ok' ? '✓' : '✗'}
          </Text>
          <Text color={check.status === 'ok' ? 'green' : 'red'}>
            {check.name}
          </Text>
          <Text dimColor>— {check.message}</Text>
          {check.fix && <Text color="yellow"> Fix: {check.fix}</Text>}
        </Box>
      ))}

      <Box marginTop={1}>
        {allOk
          ? <Text color="green" bold>All checks passed.</Text>
          : <Text color="red" bold>Some checks failed. Fix the issues above.</Text>
        }
      </Box>
    </Box>
  );
}
