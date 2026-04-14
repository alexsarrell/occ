import React from 'react';
import { Text } from 'ink';

interface Props {
  status: 'connected' | 'disconnected' | 'connecting' | 'failed';
}

export function StatusBadge({ status }: Props) {
  switch (status) {
    case 'connected':
      return <Text bold color="green">[CONNECTED]</Text>;
    case 'disconnected':
      return <Text bold color="gray">[DISCONNECTED]</Text>;
    case 'connecting':
      return <Text bold color="yellow">[CONNECTING]</Text>;
    case 'failed':
      return <Text bold color="red">[FAILED]</Text>;
  }
}
