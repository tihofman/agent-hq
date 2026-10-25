import { Box, Text } from 'ink';
import type { ActivePR, RepoItem } from '../api/types';

interface ProjectsViewProps {
  repos: RepoItem[];
  activePR?: ActivePR | null;
}

export function ProjectsView({ repos, activePR }: ProjectsViewProps) {
  if (repos.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        paddingX={1}
        borderColor="gray"
      >
        <Text bold color="yellow">
          PROJEKTE & QUEUES
        </Text>
        <Text dimColor>Keine Repositories registriert oder Daten laden...</Text>
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
      <Box marginBottom={1}>
        <Text bold color="yellow">
          PROJEKTE & QUEUES ({repos.length})
        </Text>
      </Box>
      {repos.map((r, idx) => {
        const repoName = r.repo || '(Home)';
        const homeTag = r.home ? ' [Home]' : '';
        const fe = r.queues?.frontend || {
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
        };
        const be = r.queues?.backend || {
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
        };
        const qa = r.queues?.qa || {
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
        };

        const totalWaiting = fe.waiting + be.waiting + qa.waiting;
        const totalActive = fe.active + be.active + qa.active;
        const totalFailed = fe.failed + be.failed + qa.failed;

        return (
          <Box key={r.repo ?? idx} flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold color="white">
                {repoName}
                {homeTag}
              </Text>
              <Text dimColor> ─ Total: </Text>
              <Text color="yellow">Wait: {totalWaiting} </Text>
              <Text color="green">Active: {totalActive} </Text>
              {totalFailed > 0 ? (
                <Text color="red">Failed: {totalFailed} </Text>
              ) : (
                <Text dimColor>Failed: 0 </Text>
              )}
            </Box>
            <Box paddingLeft={2}>
              <Text dimColor>
                FE: W:{fe.waiting} A:{fe.active} │ BE: W:{be.waiting} A:
                {be.active} │ QA: W:{qa.waiting} A:{qa.active}
              </Text>
            </Box>
            {r.draftPRs && r.draftPRs.length > 0 && (
              <Box flexDirection="column" paddingLeft={2}>
                <Text color="magenta">Draft PRs:</Text>
                {r.draftPRs.map((pr) => (
                  <Box key={pr.number} paddingLeft={2}>
                    <Text color="cyan">#{pr.number} </Text>
                    <Text>{pr.title} </Text>
                    <Text dimColor>({pr.url})</Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
      {activePR && (
        <Box
          borderStyle="classic"
          borderColor="magenta"
          paddingX={1}
          marginTop={1}
        >
          <Text bold color="magenta">
            Aktiver PR{' '}
            {activePR.prNumber !== undefined ? `#${activePR.prNumber}` : ''}
            :{' '}
          </Text>
          {activePR.title && <Text>{activePR.title} </Text>}
          {activePR.status && <Text color="yellow">[{activePR.status}]</Text>}
        </Box>
      )}
    </Box>
  );
}
