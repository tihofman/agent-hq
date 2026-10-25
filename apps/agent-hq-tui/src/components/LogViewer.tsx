import { Box, Text } from 'ink';
import type { Run } from '../api/types';

interface LogViewerProps {
  run: Run;
  logs: string[];
}

export function LogViewer({ run, logs }: LogViewerProps) {
  const repo = run.repo || run.data?.repo || '(Home)';
  const issue =
    run.ticketId || (run.data?.issueId ? `#${run.data.issueId}` : '') || '-';
  const displayLogs = logs.slice(-25); // Show last 25 lines in terminal

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={1}
      minHeight={15}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text bold color="cyan">
            LIVE-LOG:
          </Text>
          <Text bold color="white">
            {' '}
            {run.runId} ({repo} ─ {issue} ─ {run.agent})
          </Text>
        </Box>
        <Text color="yellow">[Esc / Enter] Zurück zur Übersicht</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        flexGrow={1}
      >
        {displayLogs.length === 0 ? (
          <Text dimColor>Warte auf Log-Ausgaben für Lauf {run.runId}...</Text>
        ) : (
          displayLogs.map((line, idx) => (
            <Text key={idx} wrap="wrap">
              {line}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
