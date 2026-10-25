import { Box, Text } from 'ink';
import {
  TEAMS,
  type Agent,
  type AgentState,
  type Team,
  type TeamState,
} from '@agent-hq/queue/types';
import { AGENTS } from '../api/types';

interface TeamsViewProps {
  teams?: Record<Team, TeamState>;
  agents?: Record<Agent, AgentState>;
}

function statusColor(status: string): string {
  switch (status) {
    case 'working':
    case 'coding':
    case 'testing':
    case 'reviewing':
      return 'green';
    case 'waiting_input':
      return 'yellow';
    case 'cooldown':
      return 'blue';
    case 'errorAlert':
      return 'red';
    case 'idle':
    default:
      return 'gray';
  }
}

export function TeamsView({ teams, agents }: TeamsViewProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      borderColor="gray"
    >
      <Box marginBottom={1}>
        <Text bold color="yellow">
          TEAMS & AGENTEN-SLOTS
        </Text>
      </Box>

      {/* Teams Row */}
      <Box marginBottom={1}>
        <Text bold>Teams: </Text>
        {TEAMS.map((team: Team) => {
          const status = teams?.[team]?.status ?? 'idle';
          const color = statusColor(status);
          return (
            <Box key={team} marginRight={2}>
              <Text bold color="white">
                {team}:{' '}
              </Text>
              <Text color={color} bold>
                {status}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Agents Slots Row */}
      <Box flexDirection="column">
        <Text bold>Slots / Agenten:</Text>
        <Box paddingLeft={1} flexDirection="row" flexWrap="wrap">
          {AGENTS.map((agent) => {
            const slot = agents?.[agent];
            const status = slot?.status ?? 'idle';
            const color = statusColor(status);
            const runInfo = slot?.runId ? ` [${slot.runId}]` : '';
            const roomInfo = slot?.room ? ` in ${slot.room}` : '';

            return (
              <Box key={agent} marginRight={3}>
                <Text bold color="cyan">
                  {agent}:{' '}
                </Text>
                <Text color={color}>{status}</Text>
                {runInfo && <Text color="yellow">{runInfo}</Text>}
                {roomInfo && <Text dimColor>{roomInfo}</Text>}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
