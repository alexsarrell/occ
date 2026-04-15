import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  logs: string[];
  expanded: boolean;
  /** Lines from end of buffer. 0 means "showing tail". */
  scrollOffset: number;
}

const COLLAPSED_HEIGHT = 5;
const EXPANDED_HEIGHT = 18;

export function LogsFooter({ logs, expanded, scrollOffset }: Props) {
  const viewportHeight = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

  const total = logs.length;
  const end = Math.max(0, total - scrollOffset);
  const start = Math.max(0, end - viewportHeight);
  const visible = logs.slice(start, end);

  const padded = [
    ...visible,
    ...Array(Math.max(0, viewportHeight - visible.length)).fill(''),
  ];

  const hint = expanded
    ? 'Enter collapse · ↑↓ scroll · Tab/Esc hide'
    : 'Enter expand · Tab/Esc hide';

  const scrollIndicator = expanded && scrollOffset > 0
    ? ` · scrolled ${scrollOffset}↑`
    : '';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginTop={1}
    >
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Logs ({total}){scrollIndicator}
        </Text>
        <Text dimColor>{hint}</Text>
      </Box>
      {padded.map((line, i) => (
        <Text key={i} wrap="truncate">
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}
