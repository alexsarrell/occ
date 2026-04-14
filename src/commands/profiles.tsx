import React from 'react';
import { Text } from 'ink';

export function ProfilesScreen({ action, name }: { action?: string; name?: string }) {
  return <Text>Profiles {action} {name} (not implemented yet)</Text>;
}
