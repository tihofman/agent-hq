import { Box, Text } from 'ink';
import type { QuestionPayload } from '@agent-hq/queue/types';

interface QuestionsViewProps {
  questions: QuestionPayload[];
  selectedIndex: number;
}

export function QuestionsView({
  questions,
  selectedIndex,
}: QuestionsViewProps) {
  if (questions.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        paddingX={1}
        borderColor="gray"
      >
        <Text bold color="yellow">
          OFFENE RÜCKFRAGEN (0)
        </Text>
        <Text dimColor>Keine offenen Rückfragen vorhanden.</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      borderColor="yellow"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="yellow">
          OFFENE RÜCKFRAGEN ({questions.length})
        </Text>
        <Text color="green" bold>
          [a] Beantworten
        </Text>
      </Box>

      {questions.map((q, idx) => {
        const isSelected = idx === selectedIndex;
        const repo = q.repo || '(Home)';

        return (
          <Box key={q.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold color={isSelected ? 'yellow' : 'gray'}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              <Text bold color="white">
                [{q.id}]
              </Text>
              <Text dimColor> │ </Text>
              <Text color="magenta">Issue #{q.issueId}</Text>
              <Text dimColor> │ </Text>
              <Text color="cyan">{repo}</Text>
              <Text dimColor> │ Team: </Text>
              <Text color="yellow">{q.team}</Text>
            </Box>
            <Box paddingLeft={4}>
              <Text bold color="white">
                "{q.question}"
              </Text>
            </Box>
            {q.options && q.options.length > 0 && (
              <Box paddingLeft={4}>
                <Text dimColor>Optionen: {q.options.join(' │ ')}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
