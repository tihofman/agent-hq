# delegate.sh installieren

Voraussetzungen: Bash, curl und jq; außerdem `agy`, `codex` bzw. `claude` im PATH.
Die Bash-Tests benötigen zusätzlich Node.js (bereits im Projekt verwendet).

Vom Repository-Verzeichnis aus das Skript in den Claude-Skill kopieren:

```bash
mkdir -p ~/.claude/skills/subagent-orchestrator
cp scripts/delegate.sh ~/.claude/skills/subagent-orchestrator/delegate.sh
```

Alternativ als Symlink einbinden (vorhandenes Skript vorher sichern/entfernen):

```bash
ln -s "$PWD/scripts/delegate.sh" ~/.claude/skills/subagent-orchestrator/delegate.sh
```

Aufruf: `scripts/delegate.sh agy "Implementiere #7"` (oder `codex` bzw. `claude`).
`AGENT_HQ_URL` überschreibt `http://127.0.0.1:3333`; `TICKET_ID` überschreibt
die Ticket-Erkennung aus dem Prompt. Logs liegen unter `${TMPDIR:-/tmp}/agent-hq/<runId>.log`.

`AGENT_HQ_LOG_DIR` überschreibt das Log-Verzeichnis (bei Server und Skript gleich setzen).

Der Kill Switch bietet eine optionale „Anweisung für Fortsetzung“ (maximal 4000 Zeichen).
Ohne Anweisung beendet er den Worker wie bisher. Mit Anweisung schreibt der Server
vor dem Signal eine `.msg` neben das registrierte Log, ausschließlich im erwarteten
Log-Verzeichnis. Nach dem Worker-Ende liest und entfernt `delegate.sh` diese Datei.
Die Anweisung erscheint als `>>> User-Anweisung: …` in stdout und im neuen Run-Log.
Jede Fortsetzung bekommt eine neue Run-ID, ein eigenes Log und neue Handover-/Start-Events;
Exit-Code und Bash-Aufruf bleiben für Claude transparent. Mehrfaches Nachsteuern ist möglich.

codex liefert die Session-ID über die erste vollständige `session id:`-Zeile mit
einer strikten UUID (`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`) im Log und wird mit `exec resume`
fortgesetzt. Da resume keine `-s`/`--add-dir`-Flags unterstützt, setzt es die Sandbox
über `-c sandbox_mode="workspace-write"`, Netzwerkzugriff und die Schreibverzeichnisse
(Arbeitsverzeichnis und `~/.npm`) explizit wie beim Erstlauf.

agy läuft mit `--output-format stream-json`: Das frühe Init-Event liefert
`conversation_id`, auch wenn der Lauf später abgebrochen wird. Der Ausgabefilter
schreibt nur für Init-Events den eigenen Marker `>>> agy init session:` und rendert
Text aus Assistant-Events zeilenweise. Gleichlautende Marker aus Text oder Diagnosen
werden eingerückt und damit von der Session-Erkennung ausgeschlossen;
unbekannte Events und Diagnosen bleiben unverändert sichtbar. So bleibt das Log für
den Tailer lesbar, ohne zusätzliche Abhängigkeit. Fortsetzung erfolgt gezielt mit
`--conversation <id>` und denselben Berechtigungen wie beim Erstlauf.
Nur die erste Init-ID wird berücksichtigt; sie muss `^[A-Za-z0-9][A-Za-z0-9_-]*$` erfüllen.
Fehlt eine gültige Session-ID, startet der Worker mit Originalprompt und bisherigen Anweisungen neu.

claude läuft nicht-interaktiv mit aktivierter Sandbox und `--permission-mode acceptEdits`.
Bash-Befehle innerhalb der Sandbox werden ohne Rückfrage freigegeben; ein unsandboxed Retry
ist deaktiviert und Claude Code muss beim Fehlen der Sandbox abbrechen. Schreibzugriff ist
auf den Worktree, `~/.npm` und das Git-Common-Verzeichnis beschränkt; letzteres wird absolut
ermittelt (`git rev-parse --git-common-dir`), damit Commits und `index.lock` im Git-Worktree
funktionieren. Pfade außerhalb von `allowWrite` blockiert die Sandbox bereits standardmäßig
(ein globales `denyWrite: ["/"]` darf nicht gesetzt werden, da `denyWrite` Vorrang vor `allowWrite`
hat und alle Schreibzugriffe blockieren würde). Zum Schutz vor Privilegieneskalation sind
`$GITDIR/hooks` und `$GITDIR/config` explizit per `denyWrite` gesperrt: So kann ein Worker keine
bösartigen Git-Hooks oder Git-Konfigurationen einschleusen, die später außerhalb der Sandbox beim Host
ausgeführt werden. Netzwerkzugriff ist auf GitHub und die npm-Registry begrenzt. Die Einstellungen
werden mit `--settings '<json>'` übergeben; `~/.npm` wird zusätzlich mit `--add-dir` freigegeben.
Die Sandbox beschränkt Shell-Befehle und deren Kindprozesse auf Betriebssystemebene.

Vor dem ersten Lauf erzeugt `delegate.sh` eine UUID (`uuidgen`, mit Plattform-Fallback) und
übergibt sie mit `--session-id`. Ist `AGENT_MODEL` gesetzt, wird es als `--model` durchgereicht.
Die Ausgabe wird unverändert in stdout und das Run-Log geschrieben (wie bei codex). Bei einer
Anweisung für Fortsetzung wird dieselbe UUID mit `--resume` verwendet. Wenn ausnahmsweise
keine UUID erzeugt werden kann, greift der ADR-0005-Fallback: `delegate.sh` startet claude mit
Originalprompt und bisherigen Anweisungen neu; eine im Log gefundene Session-ID kann dann
weiterhin mit `--resume` genutzt werden.

Prüfen mit `bash scripts/test/delegate.test.sh` und
`bash scripts/test/delegate-resume.test.sh` (Fake-CLIs, keine echten Worker).

Die lokalen Hilfen von `codex exec`, `codex exec resume`, `agy` und `claude` wurden geprüft.
Codex akzeptiert `--` als Optionsende (zusätzlich mit Parser-Proben geprüft);
das Skript setzt es vor den Prompt bei Erstlauf und Resume. Für agy und claude lässt sich
diese Unterstützung nicht verlässlich über alle Versionen bestätigen. Prompts und Anweisungen
für agy und claude dürfen deshalb nicht mit `-` beginnen; das Skript neutralisiert eine dennoch
führende `-` durch ein vorangestelltes Leerzeichen.

Endet der Worker von selbst kurz vor dem Kill, kann eine verspätet geschriebene
`.msg` ungelesen liegen bleiben. Diese harmlose Race führt zu keiner Fortsetzung;
der nächste Lauf verwendet eine neue Run-ID und liest die alte Datei nicht.

Die isolierten Parser-/Argv-Tests laufen auch ohne Worker-Start:
`bash scripts/test/delegate-resume.test.sh --unit-only`.
