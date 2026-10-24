---
name: agent-hq
description: Arbeit über die V2-Queue an Agent-HQ-Worker (agy, codex, claude) abgeben, Tickets per team:*-Label einreihen, Fortschritt und Draft-PRs verfolgen, reviewen und mergen, offene Worker-Rückfragen abrufen und beantworten sowie Agent-HQ starten, neu starten oder prüfen. Trigger, wenn der User Aufgaben an Agent-HQ oder ein Team (frontend, backend, qa) geben will, nach offenen Fragen der Worker fragt oder Agent-HQ einrichten bzw. debuggen will.
---

# Agent-HQ

Agent-HQ (SvelteKit-App `apps/agent-hq`) zieht GitHub-Issues mit `team:*`-Label in BullMQ-Queues, lässt sie von Workern in eigenen Worktrees bearbeiten und erstellt daraus Draft-PRs. Dieser Skill steuert das von Claude Code aus.

Pfade sind relativ zum Repo-Root des Servers (`<root>`). Server-URL: `HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"`.

> **Einschränkung: nur das Repo des Servers.** V2 ruft `gh issue list` ohne `--repo` im Verzeichnis des Servers auf und legt Worktrees unter `<root>/.worktrees/` an. Aufträge gehen also nur an das Repo, in dem der Server läuft. Für ein anderes Repo muss dort eine eigene Agent-HQ-Instanz laufen, sonst geht es mit V2 nicht. Sag das dem User offen. Lege keine Issues in fremden Repos an und erwarte nicht, dass sie bearbeitet werden.

## 1. Voraussetzungen prüfen

Vor jedem Einreihen der Reihe nach prüfen. Bricht ein Schritt ab, gehe zu [Setup und Betrieb](#6-setup-und-betrieb).

```bash
HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"
gh auth status                                         # gh authentifiziert
curl -s --max-time 2 "$HQ/api/questions"               # Server erreichbar, liefert JSON-Array
curl -sN --max-time 2 "$HQ/api/stream" | head -n 2 | grep -q '"teams"' \
  && echo "V2 aktiv" || echo "V2 aus oder Redis fehlt"
lsof -a -d cwd -p "$(lsof -t -nP -iTCP:"${PORT:-3333}" -sTCP:LISTEN)"   # cwd des Servers
```

- **V2 aktiv:** `teams` steht im `INIT_STATE` von `/api/stream` nur, wenn der Worker-Pool läuft. Das heißt `AGENT_HQ_V2_WORKERS=1` ist gesetzt und Redis antwortet. `GET /api/questions` liefert ohne V2 nur `[]` und taugt deshalb nicht als V2-Test.
- **Redis:** `docker compose exec -T redis redis-cli ping` im `<root>` muss `PONG` liefern.
- **Gleiches Repo:** Das cwd des Servers ist `<root>/apps/agent-hq`. Vergleiche `git -C <cwd> remote get-url origin` mit `git remote get-url origin` im aktuellen Repo. Weichen sie ab, gilt die Einschränkung oben.
- **Sandbox:** Die Claude-Sandbox blockiert `localhost`. Wenn `curl` mit Verbindungsfehler abbricht, kann das an der Sandbox liegen statt am Server. Dann den Befehl außerhalb der Sandbox ausführen oder den User bitten, ihn auszuführen.

## 2. Auftrag einreihen

Ein Auftrag ist ein offenes GitHub-Issue im Server-Repo mit genau einem `team:*`-Label und noch **ohne** `status:*`-Label. Der Ingest prüft alle 60 s (`AGENT_HQ_ISSUE_POLL_INTERVAL_MS`). Issues, die schon ein `status:*`-Label haben, überspringt er.

1. **Titel mit Präfix:** `feat:`, `fix:`, `refactor:`, `test:`, `docs:` oder `chore:` (`enhancement:` wird zu `feat`, `bug:` zu `fix`). Fehlt das Präfix, gilt `feat`. Das Präfix bestimmt Commit- und PR-Titel `<type>(#<n>): <subject>`. Der Branch heißt unabhängig davon immer `feat/<n>-<slug>`.
2. **Body nach Schema:** Kurzbeschreibung, Bearbeiter-Empfehlung & Agent-Zuweisung, Hintergrund, Ziel, Akzeptanzkriterien (prüfbare Checkliste). Der Body ist der Prompt für den Worker. Nenne Dateien, Befehle und Tests konkret.
3. **Labels:** ein Typ-Label (`feature` | `bug` | `enhancement` | `documentation`), ein `agent:*`-Label und genau ein `team:*`-Label.
4. **Team wählen:**

   | Team       | Wofür                              | Worker-Reihenfolge |
   | :--------- | :--------------------------------- | :----------------- |
   | `frontend` | UI, Svelte-Komponenten, Styles     | agy → claude       |
   | `backend`  | Server, Libs, Skripte, Doku, Infra | claude → agy       |
   | `qa`       | Tests, Test-Infrastruktur, Reviews | codex → agy        |

   Welcher Worker den Auftrag bekommt, wählt der Server je nach Verfügbarkeit und Rate-Limit. `agent:*` beeinflusst das nicht.

```bash
gh issue create --title "fix: <Titel>" --body-file ticket.md \
  --label bug --label agent:claude --label team:backend
```

**Abhängige Tickets:** Lege sie ohne `team:*`-Label an. Setze das Label erst, wenn das vorherige Ticket gemergt ist (`gh issue edit <n> --add-label team:<team>`). Sonst baut der Worker auf einem veralteten `origin/main` auf.

## 3. Fortschritt verfolgen

| Status-Label         | Bedeutung                                                                   |
| :------------------- | :-------------------------------------------------------------------------- |
| `status:queued`      | eingereiht oder nach beantworteter Rückfrage wieder eingereiht              |
| `status:in-progress` | Worker läuft im Worktree `<root>/.worktrees/feat-<n>-<slug>`                |
| `status:blocked`     | offene Rückfrage (siehe 5) oder endgültig fehlgeschlagen (nach 4 Versuchen) |
| `status:done`        | Worker fertig, Branch gepusht, Draft-PR `<type>(#<n>): …` mit `Closes #<n>` |

```bash
gh issue view <n> --json labels -q '.labels[].name'
gh pr list --head feat/<n>-<slug> --json number,url,isDraft
```

Den Draft-PR legt der Server an, nicht der Worker. Danach entfernt er den Worktree. **Reviewe erst bei `status:done`.** Vorher kann der Worker noch committen. Live-Status liefert `GET /api/stream` (SSE), das Dashboard läuft unter `$HQ`.

## 4. Review und Merge

1. **Eigener Worktree, nie im Server-Verzeichnis**, denn dort liegt der laufende Build (`apps/agent-hq/build`). Checke den Branch detached aus. Ein normal ausgecheckter `feat/<n>-<slug>` blockiert spätere Worker-Läufe und `--delete-branch`:

   ```bash
   git fetch origin feat/<n>-<slug>
   git worktree add --detach .worktrees/review-<n> origin/feat/<n>-<slug>
   ```

2. **Gegen das Ticket prüfen:** `gh issue view <n>` und `gh pr diff <pr>`. Hake jedes Akzeptanzkriterium einzeln ab. Führe die Tests im Review-Worktree aus.
3. **Nachbesserungen auf demselben Branch:** Ein erneutes Einreihen wirkt nicht. Der Job `issue-<n>` bleibt nach Abschluss in Redis, und der Ingest überspringt das Issue. Delegiere stattdessen direkt:

   ```bash
   git worktree remove .worktrees/review-<n>
   git worktree add .worktrees/fix-<n> feat/<n>-<slug>   # lokalen Branch ggf. vorher: git fetch origin feat/<n>-<slug>:feat/<n>-<slug>
   cd .worktrees/fix-<n> && <root>/scripts/delegate.sh claude "Ticket #<n>: Behebe auf diesem Branch: <Findings>. Teste, committe und pushe."
   ```

   Danach den Fix-Worktree entfernen und erneut reviewen.

4. **Ready und Merge:**

   ```bash
   gh pr ready <pr>
   gh pr checks <pr> --watch
   gh pr merge <pr> --squash --delete-branch   # nur bei grüner CI
   ```

   Ohne CI-Pipeline nicht selbst mergen. Sag dem User, dass Review und lokale Tests grün sind, und überlass ihm den Merge.

5. **Aufräumen:** `git worktree remove .worktrees/review-<n>` (bzw. `fix-<n>`) und `git worktree prune`.
6. **Server neu starten**, wenn der Merge Server-Code betrifft (`apps/agent-hq/**`, `libs/**`). Der laufende Prozess nutzt den alten Build. Siehe [Betrieb](references/operations.md#neustart).

## 5. Rückfragen beantworten

Ein Worker fragt über `scripts/hq-ask.sh`. Die Frage landet per `POST /api/questions`, der Job pausiert und das Issue bekommt `status:blocked`.

```bash
HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"
curl -s "$HQ/api/questions" | jq '.[] | {id, issueId, team, question, options}'
```

1. Lege jede Frage dem User wörtlich vor, mit Issue-Nummer und Optionen. Beantworte sie nicht selbst, außer der User hat die Entscheidung vorher getroffen.
2. Poste die Antwort. Die ID hat das Format `<issue>-<k>`, z. B. `105-1`:

   ```bash
   curl -s -X POST "$HQ/api/questions/105-1/answer" \
     -H "Content-Type: application/json" \
     -d "$(jq -nc --arg a "Dark als Default" '{answer: $a}')"
   ```

   Erfolg ist `{"ok":true}` (HTTP 200). Danach läuft der Job weiter und das Issue steht wieder auf `status:queued`.

**Origin-Regel:** Requests **ohne** `Origin`-Header (wie `curl` oben) sind erlaubt. Mit `Origin` muss der Host `127.0.0.1` oder `localhost` sein und der Port mit dem Server übereinstimmen, sonst kommt `403 Forbidden origin`. Setze keinen fremden `Origin`. Weitere Codes: `400` für eine leere Antwort oder eine mit mehr als 5000 Zeichen, `404` für eine unbekannte ID, `409` für eine schon beantwortete Frage. Details: [API-Referenz](references/api.md).

## 6. Setup und Betrieb

```bash
cd <root>
AGENT_HQ_V2_WORKERS=1 ./run.sh            # Redis via Docker Compose + Build + Server auf 127.0.0.1:3333
```

`run.sh` setzt `AGENT_HQ_V2_WORKERS` **nicht**. Ohne das Flag läuft nur V1: Dashboard und Events, aber kein Ingest und keine Worker.

| Problem                     | Erkennen                                                  | Lösung                                                                       |
| :-------------------------- | :-------------------------------------------------------- | :--------------------------------------------------------------------------- |
| Port belegt                 | `run.sh`: „Port 3333 ist bereits … belegt“, Exit 1        | alten Server beenden (siehe Neustart) oder anderen `PORT` und `AGENT_HQ_URL` |
| Redis fehlt                 | Log: „Redis nicht erreichbar, V2 deaktiviert“             | Docker starten, `docker compose up -d redis`, Server neu starten             |
| V2-Flag fehlt               | kein `teams` in `/api/stream`, Issues bleiben ohne Status | Server mit `AGENT_HQ_V2_WORKERS=1` neu starten                               |
| Issue wird nicht eingezogen | kein `status:queued` nach über 60 s                       | genau ein `team:*`, kein `status:*`, Issue offen, richtiges Repo?            |

Neustart, Logs, alle Umgebungsvariablen und weitere Fehlerbilder: [Betrieb](references/operations.md).
