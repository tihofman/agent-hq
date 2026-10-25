import { Box, Text, useInput, useStdin } from 'ink';

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  const { isRawModeSupported } = useStdin();
  useInput(
    (input, key) => {
      if (key.escape || key.return || input === '?') {
        onClose();
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          AGENT-HQ TUI ─ HILFE & TASTENBELEGUNG
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            ↑ / ↓
          </Text>
          <Text>
            {'   '}Navigation: Job oder offene Rückfrage in Liste auswählen
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            Enter
          </Text>
          <Text>{'   '}Live-Log des aktuell ausgewählten Laufs öffnen</Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            a
          </Text>
          <Text>
            {'       '}Offene Rückfrage beantworten (Optionen auswählen oder
            Freitext eingeben)
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            k
          </Text>
          <Text>
            {'       '}Ausgewählten Lauf abbrechen (Kill Switch mit
            Bestätigungsdialog)
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            Tab / 1-4
          </Text>
          <Text>
            {' '}
            Zwischen Ansichten wechseln (1: Dashboard, 2: Jobs & Logs, 3:
            Rückfragen, 4: Projekte)
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            ?
          </Text>
          <Text>{'       '}Diese Hilfe aufrufen / schließen</Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            Esc
          </Text>
          <Text>{'     '}Aktiven Dialog / Live-Log schließen</Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            q
          </Text>
          <Text>{'       '}TUI-Dashboard beenden</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="green" bold>
          [Esc / Enter / ?] Hilfe schließen
        </Text>
      </Box>
    </Box>
  );
}
