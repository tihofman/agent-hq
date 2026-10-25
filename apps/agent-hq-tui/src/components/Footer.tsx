import { Box, Text } from 'ink';

interface FooterProps {
  statusMessage?: string | null;
}

export function Footer({ statusMessage }: FooterProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      {statusMessage && (
        <Box marginBottom={1}>
          <Text bold color="green">
            ✔ {statusMessage}
          </Text>
        </Box>
      )}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            [↑/↓]{' '}
          </Text>
          <Text dimColor>Nav │ </Text>
          <Text bold color="cyan">
            [Enter]{' '}
          </Text>
          <Text dimColor>Log │ </Text>
          <Text bold color="cyan">
            [a]{' '}
          </Text>
          <Text dimColor>Antworten │ </Text>
          <Text bold color="cyan">
            [k]{' '}
          </Text>
          <Text dimColor>Kill</Text>
        </Box>
        <Box>
          <Text bold color="cyan">
            [Tab/1-4]{' '}
          </Text>
          <Text dimColor>Ansichten</Text>
        </Box>
      </Box>
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            [?]{' '}
          </Text>
          <Text dimColor>Hilfe</Text>
        </Box>
        <Box>
          <Text bold color="red">
            [q]{' '}
          </Text>
          <Text dimColor>Beenden</Text>
        </Box>
      </Box>
    </Box>
  );
}
