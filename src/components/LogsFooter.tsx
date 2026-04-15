import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  logs: string[];
  focused: boolean;
  expanded: boolean;
  /** Lines from end of buffer. 0 means "showing tail". */
  scrollOffset: number;
}

const COLLAPSED_HEIGHT = 5;
const EXPANDED_HEIGHT = 18;

export function LogsFooter({ logs, focused, expanded, scrollOffset }: Props) {
  const viewportHeight = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

  // Slice the buffer based on scrollOffset, showing `viewportHeight` lines.
  const total = logs.length;
  const end = Math.max(0, total - scrollOffset);
  const start = Math.max(0, end - viewportHeight);
  const visible = logs.slice(start, end);

  // Pad so box stays the same height even with few logs
  const padded = [
    ...visible,
    ...Array(Math.max(0, viewportHeight - visible.length)).fill(''),
  ];

  const hint = focused
    ? (expanded
        ? 'Enter: collapse · ↑/↓: scroll · Tab: back to app'
        : 'Enter: expand · Tab: back to app')
    : 'Tab: focus logs';

  const scrollIndicator = expanded && scrollOffset > 0
    ? ` · scrolled ${scrollOffset} line${scrollOffset === 1 ? '' : 's'} up`
    : '';

  return (
    <Box
      flexDirection="column"
      borderStyle={focused ? 'round' : 'single'}
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={focused ? 'cyan' : undefined}>
          Logs ({total} line{total === 1 ? '' : 's'}){scrollIndicator}
        </Text>
        <Text dimColor>{hint}</Text>
      </Box>
      {padded.map((line, i) => (
        <Text key={i} dimColor={!focused} wrap="truncate">
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}
