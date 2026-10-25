import { Box, Text, useStdout } from 'ink';
import type { Run } from '@agent-hq/queue/types';

interface JobsViewProps {
  runs: Run[];
  selectedIndex: number;
  title?: string;
  columns?: number;
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  if (maxLen <= 1) return '…';
  return str.slice(0, maxLen - 1) + '…';
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

export function JobsView({
  runs,
  selectedIndex,
  title = 'LAUFENDE JOBS',
  columns,
}: JobsViewProps) {
  const { stdout } = useStdout();
  const terminalColumns = columns ?? stdout?.columns ?? 80;
  // App padding (2) + own border (2) + paddingX (2), plus 1: the styled row was measured to wrap one column early.
  const innerWidth = Math.max(40, terminalColumns - 7);

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

  const hasKillable = runs.some(
    (r) => r.status === 'running' || r.status === 'handover',
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      borderColor="gray"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="yellow">
          {title} ({runs.length})
        </Text>
        <Text dimColor>
          [Enter] Log öffnen{hasKillable ? ' │ [k] Abbrechen' : ''}
        </Text>
      </Box>

      {runs.map((run, idx) => {
        const isSelected = idx === selectedIndex;
        const color = statusColor(run.status);
        const repo = run.repo || run.data?.repo || '(Home)';
        const issue =
          run.ticketId ||
          (run.data?.issueId ? `#${run.data.issueId}` : '') ||
          '-';
        const titleText = run.data?.title ? ` - ${run.data.title}` : '';

        const prefix = isSelected ? '▶ ' : '  ';
        const idStr = `[${run.runId}]`;
        const issueStr = `Issue: ${issue}`;
        const agentStr = `Agent: ${run.agent}`;
        const statusStr = run.status;
        const nonRepoWidth =
          prefix.length +
          idStr.length +
          3 + // ' │ '
          6 + // 'Repo: '
          3 + // ' │ '
          issueStr.length +
          3 + // ' │ '
          agentStr.length +
          3 + // ' │ '
          statusStr.length;
        const maxRepoLen = Math.max(4, innerWidth - nonRepoWidth);
        const displayRepo = truncate(repo, maxRepoLen);

        return (
          <Box key={run.runId} flexDirection="column" marginBottom={1}>
            <Text>
              <Text bold color={isSelected ? 'cyan' : 'gray'}>
                {prefix}
              </Text>
              <Text bold color="white">
                {idStr}
              </Text>
              <Text dimColor> │ </Text>
              <Text color="yellow">Repo: {displayRepo}</Text>
              <Text dimColor> │ </Text>
              <Text color="magenta">{issueStr}</Text>
              <Text dimColor> │ </Text>
              <Text color="cyan">{agentStr}</Text>
              <Text dimColor> │ </Text>
              <Text color={color} bold>
                {statusStr}
              </Text>
            </Text>
            {titleText && (
              <Box paddingLeft={4}>
                <Text dimColor>{truncate(titleText, innerWidth - 4)}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
