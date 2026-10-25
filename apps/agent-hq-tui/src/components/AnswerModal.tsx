import { useState } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import type { QuestionPayload } from '../api/types';

interface AnswerModalProps {
  question: QuestionPayload;
  onSubmit: (answer: string) => Promise<void>;
  onCancel: () => void;
}

export function AnswerModal({
  question,
  onSubmit,
  onCancel,
}: AnswerModalProps) {
  const { isRawModeSupported } = useStdin();
  const options = question.options ?? [];
  const hasOptions = options.length > 0;

  // If there are options, add "[ Freitext eingeben ]" as last option
  const optionList = hasOptions ? [...options, '[ Freitext eingeben ]'] : [];

  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [isFreeText, setIsFreeText] = useState(!hasOptions);
  const [freeTextValue, setFreeTextValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useInput(
    (input, key) => {
      if (submitting) return;

      if (key.escape) {
        onCancel();
        return;
      }

      if (!isFreeText) {
        if (key.upArrow) {
          setSelectedOptionIndex((prev) =>
            prev > 0 ? prev - 1 : optionList.length - 1,
          );
        } else if (key.downArrow) {
          setSelectedOptionIndex((prev) =>
            prev < optionList.length - 1 ? prev + 1 : 0,
          );
        } else if (key.return) {
          const chosen = optionList[selectedOptionIndex];
          if (chosen === '[ Freitext eingeben ]') {
            setIsFreeText(true);
          } else {
            setSubmitting(true);
            onSubmit(chosen).catch((err: unknown) => {
              setSubmitting(false);
              setErrorMessage(
                err instanceof Error ? err.message : 'Fehler beim Senden',
              );
            });
          }
        }
      } else {
        // Free text mode
        if (key.return) {
          const trimmed = freeTextValue.trim();
          if (!trimmed) {
            setErrorMessage('Antwort darf nicht leer sein');
            return;
          }
          setSubmitting(true);
          onSubmit(trimmed).catch((err: unknown) => {
            setSubmitting(false);
            setErrorMessage(
              err instanceof Error ? err.message : 'Fehler beim Senden',
            );
          });
        } else if (key.backspace || key.delete) {
          setFreeTextValue((prev) => prev.slice(0, -1));
          setErrorMessage(null);
        } else if (input && !key.ctrl && !key.meta) {
          setFreeTextValue((prev) => prev + input);
          setErrorMessage(null);
        }
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="green"
      paddingX={1}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="green">
          RÜCKFRAGE BEANTWORTEN: [{question.id}]
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold color="white">
          "{question.question}"
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          Issue #{question.issueId} │ Team: {question.team} │ Repo:{' '}
          {question.repo || '(Home)'}
        </Text>
      </Box>

      {!isFreeText ? (
        <Box flexDirection="column" marginY={1}>
          <Text bold color="yellow">
            Bitte Option auswählen:
          </Text>
          {optionList.map((opt, idx) => {
            const isSelected = idx === selectedOptionIndex;
            return (
              <Box key={idx} paddingLeft={2}>
                <Text bold color={isSelected ? 'green' : 'gray'}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text color={isSelected ? 'green' : 'white'} bold={isSelected}>
                  {opt}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box flexDirection="column" marginY={1}>
          <Text bold color="yellow">
            Freitext-Antwort eingeben:
          </Text>
          <Box
            borderStyle="single"
            borderColor="cyan"
            paddingX={1}
            marginTop={1}
          >
            <Text color="cyan">Antwort: </Text>
            <Text color="white" bold>
              {freeTextValue}
            </Text>
            <Text color="green">█</Text>
          </Box>
        </Box>
      )}

      {errorMessage && (
        <Box marginTop={1}>
          <Text color="red" bold>
            Fehler: {errorMessage}
          </Text>
        </Box>
      )}

      {submitting && (
        <Box marginTop={1}>
          <Text color="yellow">Sende Antwort an Server...</Text>
        </Box>
      )}

      <Box marginTop={1} justifyContent="space-between">
        <Text dimColor>[Enter] Bestätigen</Text>
        <Text dimColor>[Esc] Abbrechen</Text>
      </Box>
    </Box>
  );
}
