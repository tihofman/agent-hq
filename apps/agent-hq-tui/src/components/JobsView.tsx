import { Box, Text } from 'ink';
import type { Run } from '../api/types';

interface JobsViewProps {
  runs: Run[];
  selectedIndex: number;
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'green';
    case 'handover':
      return 'cyan';
    case 'cooldown':
      return 'blue';
    case 'failed':
      return 'red';
    case 'aborted':
      return 'magenta';
    case 'complete':
      return 'gray';
    default:
      return 'white';
  }
}

export function JobsView({ runs, selectedIndex }: JobsViewProps) {
  if (runs.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        paddingX={1}
        borderColor="gray"
      >
        <Text bold color="yellow">
          LAUFENDE JOBS (0)
        </Text>
        <Text dimColor>Keine aktiven Jobs in Bearbeitung.</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      borderColor="gray"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="yellow">
          LAUFENDE JOBS ({runs.length})
        </Text>
        <Text dimColor>[Enter] Log öffnen │ [k] Abbrechen</Text>
      </Box>

      {runs.map((run, idx) => {
        const isSelected = idx === selectedIndex;
        const color = statusColor(run.status);
        const repo = run.repo || run.data?.repo || '(Home)';
        const issue =
          run.ticketId ||
          (run.data?.issueId ? `#${run.data.issueId}` : '') ||
          '-';
        const title = run.data?.title ? ` - ${run.data.title}` : '';

        return (
          <Box key={run.runId} flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold color={isSelected ? 'cyan' : 'gray'}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              <Text bold color="white">
                [{run.runId}]
              </Text>
              <Text dimColor> │ </Text>
              <Text color="yellow">Repo: {repo}</Text>
              <Text dimColor> │ </Text>
              <Text color="magenta">Issue: {issue}</Text>
              <Text dimColor> │ </Text>
              <Text color="cyan">Agent: {run.agent}</Text>
              <Text dimColor> │ </Text>
              <Text color={color} bold>
                {run.status}
              </Text>
            </Box>
            {title && (
              <Box paddingLeft={4}>
                <Text dimColor>{title}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
