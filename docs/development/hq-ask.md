# Rückfragen des Workers (`hq-ask.sh`)

Das Hilfsskript `scripts/hq-ask.sh` ermöglicht es einem Worker (z. B. `agy`, `codex`, `claude`), bei unklaren Anforderungen oder fehlenden Architekturentscheidungen eine strukturierte Rückfrage an Agent-HQ zu senden ([ADR 0006](../adr/0006-queue-architektur-v2.md) Abschnitt 3).

---

## 1. Voraussetzungen & Umgebungsvariablen

Das Skript benötigt `bash`, `curl` und `jq` im PATH.

Beim Start eines Laufs durch den Worker-Pool (#98) übergibt `delegate.sh` die folgenden Umgebungsvariablen an den Worker-Prozess:

| Variable       | Pflicht | Beschreibung                                  | Default                 |
| :------------- | :------ | :-------------------------------------------- | :---------------------- |
| `HQ_ISSUE_ID`  | Ja      | Nummer bzw. ID des bearbeiteten GitHub-Issues | _(keiner)_              |
| `HQ_TEAM`      | Ja      | Team-Kennung (`frontend`, `backend`, `qa`)    | _(keiner)_              |
| `AGENT_HQ_URL` | Nein    | Basis-URL der Agent-HQ-Instanz                | `http://127.0.0.1:3333` |

Fehlt `HQ_ISSUE_ID` oder `HQ_TEAM`, bricht `hq-ask.sh` mit Exit 1 ab, ohne einen Request zu senden.

---

## 2. Verwendung

```bash
scripts/hq-ask.sh "<Frage>" [--option "<Option A>" --option "<Option B>" ...]
```

### Argumente & Optionen

- `<Frage>` (Pflicht): Der Fragetext als erstes positionales Argument.
- `--option <Wert>` bzw. `-o <Wert>` (Optional, wiederholbar): Vordefinierte Antwortmöglichkeiten für den User.

### Beispiele

Rückfrage ohne Optionen:

```bash
scripts/hq-ask.sh "Soll für das Routing SvelteKit 2 Shallow Routing verwendet werden?"
```

Rückfrage mit Optionen:

```bash
scripts/hq-ask.sh "Welche Farbpalette soll als Default gesetzt werden?" \
  --option "System/Auto" \
  --option "Dark" \
  --option "Light"
```

---

## 3. Protokoll & Payload

Das Skript baut den JSON-Body per `jq` sauber escaped auf und sendet ihn via `POST $AGENT_HQ_URL/api/questions`:

```json
{
  "issueId": 105,
  "team": "frontend",
  "question": "Welche Farbpalette soll als Default gesetzt werden?",
  "options": ["System/Auto", "Dark", "Light"]
}
```

Wenn keine Optionen übergeben wurden, entfällt das optionale Feld `options`:

```json
{
  "issueId": 105,
  "team": "frontend",
  "question": "Soll für das Routing SvelteKit 2 Shallow Routing verwendet werden?"
}
```

---

## 4. Exit-Codes & Verhalten

- **Erfolg (HTTP 2xx):** Exit-Code 0. Die letzte Zeile der Standardausgabe lautet:
  `Rückfrage gestellt. Beende dich jetzt ohne weitere Änderungen.`
  Der Worker muss sich danach unmittelbar beenden.
- **Server nicht erreichbar oder Nicht-2xx:** Exit-Code ≠ 0 mit Fehlermeldung auf `stderr`.
- **Timeouts:** Kurze Timeouts (`--connect-timeout 0.1 --max-time 0.5`) verhindern ein langes Blockieren, falls der Server nicht antwortet.
