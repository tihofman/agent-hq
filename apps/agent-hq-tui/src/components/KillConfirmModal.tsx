import { useState } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import type { Run } from '@agent-hq/queue/types';

interface KillConfirmModalProps {
  run: Run;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function KillConfirmModal({
  run,
  onConfirm,
  onCancel,
}: KillConfirmModalProps) {
  const { isRawModeSupported } = useStdin();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const repo = run.repo || run.data?.repo || '(Home)';
  const issue =
    run.ticketId || (run.data?.issueId ? `#${run.data.issueId}` : '') || '-';

  useInput(
    (input, key) => {
      if (submitting) return;

      if (key.escape || input.toLowerCase() === 'n') {
        onCancel();
        return;
      }

      if (input.toLowerCase() === 'y' || key.return) {
        setSubmitting(true);
        onConfirm().catch((err: unknown) => {
          setSubmitting(false);
          setErrorMessage(
            err instanceof Error ? err.message : 'Abbruch fehlgeschlagen',
          );
        });
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="red"
      paddingX={1}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="red">
          ⚠️ LAUF ABBRECHEN (KILL SWITCH)
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold color="white">
          Soll der folgende Lauf wirklich abgebrochen werden?
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
        <Text color="cyan">Lauf-ID: {run.runId}</Text>
        <Text color="yellow">Repo: {repo}</Text>
        <Text color="magenta">Issue: {issue}</Text>
        <Text color="white">Agent: {run.agent}</Text>
        <Text color="red">Status: {run.status}</Text>
      </Box>

      {errorMessage && (
        <Box marginBottom={1}>
          <Text color="red" bold>
            Fehler: {errorMessage}
          </Text>
        </Box>
      )}

      {submitting ? (
        <Text color="yellow">Sende Abbruch-Signal (SIGTERM/SIGKILL)...</Text>
      ) : (
        <Box justifyContent="space-between" marginTop={1}>
          <Text bold color="red">
            [y / Enter] Ja, abbrechen
          </Text>
          <Text color="green">[n / Esc] Nein, zurück</Text>
        </Box>
      )}
    </Box>
  );
}
