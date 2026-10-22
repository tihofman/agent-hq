# Spike #17: Bidirektionaler Chat über PTY

Wegwerf-Prototyp zur Entscheidung in [ADR 0005](../../docs/adr/0005-kein-pty-chat-korrektur-per-resume.md). Kein Teil von `apps/`, keine Abhängigkeiten im Root-`package.json`.

## Ausführen

Abhängigkeiten nur in einem Scratch-Verzeichnis installieren; das Skript lädt sie aus dem aktuellen Verzeichnis und legt dort pro Lauf ein `run-<agent>-*`-Verzeichnis an (cwd des Workers).

```bash
mkdir -p /tmp/spike17 && cd /tmp/spike17
npm init -y >/dev/null && npm i node-pty @xterm/headless
chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper   # sonst: "posix_spawnp failed"

node <repo>/spikes/pty-chat/pty-probe.mjs codex Ja
node <repo>/spikes/pty-chat/pty-probe.mjs agy "" Ja Ja   # "" bestätigt den Trust-Dialog
```

Der Worker bekommt einen trivialen Prompt („stelle eine Ja/Nein-Rückfrage, danach nur OK“). Jede weitere Eingabe wird nach 4s Ruhe als Text + Enter ins PTY geschrieben. Pro Schritt landen der gerenderte Bildschirm (`screen-*.txt`, via `@xterm/headless`), die Rohausgabe (`raw.log`) und Statistiken (`stats.json`) im Lauf-Verzeichnis. Start ohne `--dangerously-skip-permissions`: `codex -s read-only -a on-request`, `agy --mode plan -i`.

## Beobachtungen (22.10.2026, codex-cli 0.162.1, agy 1.4.5, node-pty 1.1.0, macOS arm64)

|                          | codex                                                                                                                                               | agy                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Start im PTY             | ✅                                                                                                                                                  | ✅                                                                                        |
| Eingabe erreicht Worker  | ✅ „Soll ich fortfahren?“ → `Ja` → „OK“                                                                                                             | ✅ „Möchtest du fortfahren?“ → `Ja` → „OK“                                                |
| Erster Bildschirm        | Chat; in einem von zwei Läufen zusätzlich Update-Hinweis-Box                                                                                        | Trust-Dialog „Do you trust the contents of this project?“ (jedes neue Verzeichnis)        |
| Darstellung              | Alt-Screen-Vollbild-TUI: 446 Cursor-Positionierungen, 200 Synchronized-Output-Frames für einen Mini-Dialog, Maus-Tracking, Kitty-Keyboard-Protokoll | Alt-Screen beim Start, danach Inline-TUI mit Erase-Line-Redraws, Kitty-Keyboard-Protokoll |
| Rohlog ohne ANSI         | **1 Zeile** (alles cursor-adressiert)                                                                                                               | 204 Zeilen, aber mit Redraw-Duplikaten                                                    |
| Prozessende nach Antwort | ❌ wartet auf nächste Eingabe (`exitCode: null`)                                                                                                    | ❌ ebenso                                                                                 |

Weitere Befunde:

- **Eingabe ist zeitkritisch**: Bei agy wurde das erste Enter auf den Trust-Dialog verschluckt; erst die nächste Eingabe bestätigte ihn. Im Plan-Modus setzt agy der Eingabe `/plan` voran.
- **Native-Modul-Reibung**: `npm i node-pty` lädt Prebuilds (kein Compile), aber `spawn-helper` hat kein Exec-Bit → `Error: posix_spawnp failed` bis `chmod +x`.
- **Kein strukturiertes „wartet auf Eingabe“-Signal**: Eine Rückfrage ist im Stream nur als gerenderter Text erkennbar (Screen-Scraping).
- **Headless-Fortsetzung funktioniert** (Alternative zum PTY):
  - `codex exec --skip-git-repo-check -s read-only "Merke dir die Zahl 7 …"` → Log enthält `session id: <uuid>`; `codex exec resume <uuid> "Welche Zahl …?"` → `7`, Exit 0.
  - `agy --mode plan -p "Merke dir die Zahl 7 …"` → `agy -c -p "Welche Zahl …?"` → `7`, Exit 0. Die ID liefert `--output-format json|stream-json` (`conversation_id`, bei stream-json im ersten `init`-Event). Gezielt per ID: „Merke dir 4“ (`--output-format json`) → anderer Lauf dazwischen → `agy --conversation <id> -p "Welche Zahl …?"` → `4`, Exit 0.
- Nicht verifiziert: `codex queue --thread <id> --message <text>` (Nachricht an laufende Session) und agy `--input-format stream-json` (mehrere Turns über stdin).
