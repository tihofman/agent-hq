# ADR 0005: Kein PTY-Chat – Korrektur per Abbruch und Session-Fortsetzung

## Status

Accepted (2026-10-22)

## Kontext

Projektplan 6H sieht einen bidirektionalen Chat vor (Chat-Eingabe, `QuestionCard`, `POST /api/chat/send`), falls ein Spike zeigt, dass `agy` / `codex` über ein vom Server verwaltetes PTY steuerbar sind, ohne die Delegation über Claude zu brechen. Heute startet Claudes Bash-Tool `delegate.sh`, das den Worker headless (`agy -p`, `codex exec`, ohne TTY) laufen lässt; Exit-Code und stdout gehen an Claude zurück, Agent-HQ beobachtet nur und kann registrierte PIDs beenden ([ADR 0004](0004-worker-als-hintergrundprozess.md)).

Der Spike ([`spikes/pty-chat/`](../../spikes/pty-chat/README.md)) hat beide CLIs interaktiv unter `node-pty` gestartet und Eingaben injiziert. Ergebnisse:

1. **Technisch machbar**: Beide Worker stellen die Rückfrage, die injizierte Antwort `Ja` kommt an, beide antworten `OK`.
2. **Ausgabe ist eine Vollbild-TUI, kein Log**: codex rendert im Alt-Screen mit Cursor-Adressierung (446 Positionierungen, 200 Frames für einen Mini-Dialog); ohne ANSI-Sequenzen bleibt vom Rohlog **eine** Zeile. agy rendert inline mit Redraws. Der zeilenbasierte Log-Tailer (#9) und der Markdown-Live-Feed können das nicht verarbeiten; nötig wären Terminal-Emulation (xterm.js) im Browser und Screen-Scraping für eine `QuestionCard`. Ein strukturiertes Signal „wartet auf Eingabe“ gibt es nicht.
3. **Eingabe ist fragil**: agy zeigt in jedem neuen Verzeichnis einen Trust-Dialog, das erste Enter darauf wurde verschluckt; codex blendet nicht-deterministisch eine Update-Box ein; beide aktivieren Kitty-Keyboard-Protokoll, codex zusätzlich Maus-Tracking.
4. **Kein Prozessende**: Interaktive Sessions warten nach der Antwort auf die nächste Eingabe (`exitCode: null`). Es gibt keinen natürlichen Exit-Code mehr für Claude.
5. **Native-Modul-Reibung**: `node-pty` installiert Prebuilds, aber `spawn-helper` ohne Exec-Bit → `posix_spawnp failed` bis `chmod +x`.
6. **Headless-Fortsetzung funktioniert**: `codex exec resume <session-id> "<prompt>"` und `agy --conversation <id> -p "<prompt>"` setzen eine Session mit vollem Kontext fort (Test: „Merke dir 7“ → Fortsetzung → `7`, auch mit einem anderen Lauf dazwischen). codex schreibt `session id: <uuid>` ins Log, agy liefert `conversation_id` per `--output-format json|stream-json`.

Bewertete Optionen für das Zusammenspiel mit Claudes Delegation:

- **(a) Server-eigenes PTY, Claude wartet per API**: Der Server startet den Worker, Claude pollt einen Endpoint auf Ergebnis/Exit-Code. Bricht den Kern-Workflow (Claude startet Worker per Bash, Server nur Beobachter), macht den Server zur Pflichtkomponente (Dashboard aus = keine Delegation) und braucht Heuristiken für „fertig“, weil die interaktive Session nicht endet. Dazu TUI-Rendering, Screen-Scraping und Native-Modul. Hohe Komplexität, geringe Robustheit.
- **(b) Headless bleibt, UI kann abbrechen und nachsteuern**: Kill Switch plus Zusatzanweisung, danach Fortsetzung derselben Session per `resume` / `--conversation`. Delegation, Exit-Code und Log-Format bleiben unverändert; keine neue Abhängigkeit.
- **(c) Inbox-Datei pro Lauf, die der Worker prüfen soll**: Hängt davon ab, dass das Modell von sich aus eine Datei liest. Nicht deterministisch, Zeitpunkt unklar, belastet jeden Prompt. Verworfen.

## Entscheidung

- **No-Go** für den bidirektionalen PTY-Chat: keine Chat-Eingabe, keine `QuestionCard` mit Antwortfunktion, kein `POST /api/chat/send`, kein `node-pty`.
- **Option (b)** wird umgesetzt, ergänzt um Session-Fortsetzung („Unterbrechen & nachsteuern“):
  - Der Kill Switch (`POST /api/kill`) nimmt optional eine Anweisung `message` an. Der Server schreibt sie vor dem Kill neben das Run-Log (`<runId>.msg`, Pfad aus `data.logFile`).
  - `delegate.sh` ermittelt pro Lauf die Session-ID (codex: `session id:` im Log; agy: `conversation_id`). Endet der Worker und liegt eine `.msg` vor, setzt `delegate.sh` dieselbe Session mit dieser Anweisung headless fort. Andernfalls verhält es sich wie bisher.
  - Die Anweisung wird in stdout und Log ausgegeben, damit Claude die Korrektur im Ergebnis sieht. Der Exit-Code des letzten Laufs geht an Claude.
- Die read-only Rückfrage-Hinweiskarte (5.3, `PendingInputCard`) bleibt wie geplant.

## Konsequenzen

### Positiv

- Claudes Delegation über das Bash-Tool, Exit-Codes und das zeilenbasierte Run-Log bleiben unverändert. Agent-HQ bleibt optional.
- Korrekturen verlieren keinen Kontext: Die Session wird fortgesetzt statt kalt neu delegiert.
- Keine native Abhängigkeit, kein Terminal-Emulator im Browser, kein Screen-Scraping. 100 % ohne API-Key, nur die vorhandenen CLI-Abos.
- Kleiner Diff: ein optionales Feld am Kill-Endpoint, eine Datei pro Lauf, eine Schleife in `delegate.sh`.

### Negativ / Trade-offs

- Kein echter Dialog: Der User kann nur abbrechen und eine Anweisung mitgeben, nicht auf eine Rückfrage antworten, während der Worker wartet. Mit `--dangerously-skip-permissions` entstehen ohnehin kaum Rückfragen.
- Abbruch verwirft den laufenden Turn; halbfertige Dateiänderungen bleiben im Worktree und müssen vom fortgesetzten Lauf aufgeräumt werden.
- `delegate.sh` hängt an CLI-spezifischen Details (Format der Session-ID, `resume`-Syntax), die sich mit CLI-Updates ändern können.
- Nicht untersucht: `codex queue` (Nachricht an laufende Session) und agys `--input-format stream-json`. Sie könnten später einen echten Chat ohne PTY ermöglichen und wären dann ein neuer Spike.
