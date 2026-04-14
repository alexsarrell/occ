import React from 'react';
import { Text } from 'ink';

export function ConnectScreen({ profileName }: { profileName?: string }) {
  return <Text>Connecting to {profileName ?? 'default'}...</Text>;
}
