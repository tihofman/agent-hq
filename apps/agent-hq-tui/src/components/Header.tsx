import { Box, Text } from 'ink';

interface HeaderProps {
  connected: boolean;
  baseUrl: string;
  reconnectIn?: number;
  activeTab: string;
}

export function Header({
  connected,
  baseUrl,
  reconnectIn,
  activeTab,
}: HeaderProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={connected ? 'cyan' : 'red'}
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            AGENT-HQ TUI
          </Text>
          <Text dimColor> │ </Text>
          <Text bold color="white">
            {activeTab.toUpperCase()}
          </Text>
        </Box>
        <Box>
          {connected ? (
            <Text color="green">● Verbunden ({baseUrl})</Text>
          ) : (
            <Text color="red" bold>
              ○ Getrennt ({baseUrl})
              {reconnectIn !== undefined && reconnectIn > 0
                ? ` ─ Retry in ${Math.ceil(reconnectIn / 1000)}s`
                : ''}
            </Text>
          )}
        </Box>
      </Box>
      {!connected && (
        <Box marginTop={1}>
          <Text color="yellow">
            Hinweis: Agent-HQ Server nicht erreichbar. Automatischer Reconnect
            aktiv. Starten Sie ggf. den Server mit: ./run.sh
          </Text>
        </Box>
      )}
    </Box>
  );
}
