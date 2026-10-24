# ADR 0007: Mehrere Repos in einer Agent-HQ-Instanz

## Status

Accepted (2026-10-25)

## Kontext

V2 ([ADR 0006](0006-queue-architektur-v2.md)) bearbeitet nur das Repo, aus dem der Server gestartet wurde:

- Der Ingest ruft `gh issue list` ohne `--repo` im Server-Verzeichnis auf.
- `repoRoot` ist `git rev-parse --show-toplevel` des Servers. Der Worker-`cwd` fällt auf `process.cwd()` zurück (`apps/agent-hq`).
- Job-ID `issue-<n>`, Session-Hash `agent-hq:session:<jobId>`, Rückfragen und Status-Labels hängen nur an der Issue-Nummer. Bei zwei Repos kollidieren diese Schlüssel: BullMQ dedupliziert per Job-ID, sodass Issue #12 eines zweiten Repos nie eingereiht würde.

Der User will auch andere Projekte über dieselbe Instanz laufen lassen und alle auf einem Bildschirm sehen. Die Subscriptions (Worker-Slots, Rate-Limits) gehören zum Rechner, nicht zum Repo. Deshalb soll es eine Instanz mit gemeinsamem Worker-Pool geben, nicht eine Instanz pro Repo.

## Entscheidung

### 1. Repo-Registry

- Die registrierten Repos stehen in `$AGENT_HQ_HOME/repos.json` als `[{ "repo": "owner/name", "path": "/abs/pfad", "enabled": true }]`. Eine Datei statt Redis, damit Liste und Projektansicht auch ohne Redis funktionieren.
- Ist die Registry leer oder fehlt sie, gilt nur das **Home-Repo** (das Repo des Servers). Damit bleibt das heutige Verhalten erhalten.
- Ein Repo kommt nur durch eine ausdrückliche Aktion des Users dazu, entweder in der UI oder per `POST /api/repos`. Entfernt wird es per `DELETE /api/repos/:repo`. Beide Endpunkte haben dieselbe Origin-Prüfung wie die übrigen POST-Endpunkte. Begründung: Jedes registrierte Repo bekommt Worker mit weitreichenden Rechten (agy läuft mit `--dangerously-skip-permissions`). Die Registry ist eine Vertrauensgrenze.
- Beim Registrieren wird geprüft, dass der Pfad existiert, ein Git-Repo ist und `gh repo view --json nameWithOwner` dort das angegebene `owner/name` liefert. Danach legt der Server **einmalig** die Labels `team:*` und `status:*` im Ziel-Repo an (`gh label create --force`). Die UI weist vorher darauf hin, dass dabei auf GitHub geschrieben wird. Außerdem trägt der Server `.worktrees/` in `.git/info/exclude` des Ziel-Repos ein.
- Lokale Repos ohne GitHub-Remote (`local`) lassen sich nicht registrieren, weil es dort nichts einzulesen gibt.

### 2. Job-Identität

- In den Job-Daten stehen `repo` (`owner/name`) und `issueId`. Die Job-ID ist nur ein eindeutiger, deterministischer Schlüssel für die Deduplizierung: `<owner>/<name>#<n>`. BullMQ verbietet nur `:` und rein numerische IDs. Code liest Repo und Issue **aus den Job-Daten** (`queue.getJob(id)`) und zerlegt die ID nie. Owner- und Repo-Namen enthalten `-`, `_` und `.`.
- Abgeleitete Schlüssel folgen der Job-ID: Session-Hash, Rückfragen und Promote.
- `delegate.sh` gibt `hq-ask.sh` neben der Issue-Nummer auch Repo und Job-ID mit. `POST /api/questions` ordnet die Frage dem Job darüber zu.
- **Altbestand:** Eine Job-ID `issue-<n>` ohne `repo` in den Daten gehört zum Home-Repo. So überleben laufende und pausierte Jobs sowie Sessions das Update. Neue Jobs des Home-Repos bekommen das neue Format. Doppelt eingereiht wird nichts, weil der Ingest Issues mit `status:*`-Label überspringt.

### 3. Ingest, Worktree und PR pro Repo

- Der Ingest läuft für jedes aktivierte Repo und jedes Team mit `gh issue list --repo <owner/name>`. Status-Labels und PR-Erstellung nutzen ebenfalls `--repo`.
- `repoRoot` und Worker-`cwd` kommen aus dem Registry-Eintrag des Jobs. Die Worktrees liegen wie bisher unter `<path>/.worktrees/feat-<n>-<slug>`, damit sie zu den Repo-Konventionen des Users passen. `delegate.sh` leitet die Sandbox-Pfade (`$PWD`, Git-Common-Dir) schon heute aus dem Worktree ab. `AGENT_HQ_DELEGATE_SCRIPT` und der Pfad zu `hq-ask.sh` werden absolut aufgelöst, nicht relativ zum Server-`cwd`.
- Der Worker-Prompt enthält keine agent-hq-spezifischen Befehle (`nx`, Pfade) mehr. Wie gebaut und getestet wird, legen die Akzeptanzkriterien des Tickets und die Doku des Ziel-Repos fest.
- Die Team-Queues und der Worker-Pool (4 Slots) bleiben gemeinsam für alle Repos. Die Kapazität richtet sich nach den Subscriptions, nicht nach den Repos.
- Polling-Last: 3 Teams × Anzahl Repos `gh`-Aufrufe pro Intervall (`AGENT_HQ_ISSUE_POLL_INTERVAL_MS`, Default 60 s). Für eine Handvoll Repos ist das unkritisch. Bei Rate-Limit-Problemen mit der GitHub-API wird das Intervall erhöht.

### 4. Ein Bildschirm für alle Projekte

- Eine Projektseite listet die registrierten Repos mit Status (aktiv/inaktiv), Queue-Zählern pro Team, offenen Rückfragen und offenen Draft-PRs. Dort lassen sich Repos hinzufügen, entfernen und aktivieren.
- Im Büro ist das Repo jedes Laufs über Tooltip, Badge oder Log-Modal erkennbar. **Nicht** im Text der Sprechblase: Die Überlappungsgarantie aus #137 hängt an `MAX_TITLE_LEN = 20`.
- Runs, Events und Historie tragen das Feld `repo`. Ältere Einträge ohne `repo` gelten als Home-Repo.

## Konsequenzen

- Agent-HQ kann jedes GitHub-Repo des Users bearbeiten, mit gemeinsamer Kapazität und Übersicht.
- Die Registrierung schreibt in fremde Repos (Labels auf GitHub, `.git/info/exclude` lokal). Das passiert nur auf ausdrückliche Aktion des Users.
- Die Job-ID ist nicht mehr gleich der Issue-Nummer. Werkzeuge und Doku, die `issue-<n>` annehmen, werden angepasst, darunter der Skill `skills/agent-hq` (#145).
- Der Server muss nach dem Merge der Backend-Änderung neu gestartet werden. Vor dem Neustart darf kein V2-Job aktiv sein.
