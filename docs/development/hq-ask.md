# Rückfragen des Workers (`hq-ask.sh`)

Das Hilfsskript `scripts/hq-ask.sh` ermöglicht es einem Worker (z. B. `agy`, `codex`, `claude`), bei unklaren Anforderungen oder fehlenden Architekturentscheidungen eine strukturierte Rückfrage an Agent-HQ zu senden ([ADR 0006](../adr/0006-queue-architektur-v2.md) Abschnitt 3).

---

## 1. Voraussetzungen & Umgebungsvariablen

Das Skript benötigt `bash`, `curl` und `jq` im PATH.

Beim Start eines Laufs durch den Worker-Pool (#98) übergibt `delegate.sh` die folgenden Umgebungsvariablen an den Worker-Prozess:

| Variable             | Pflicht | Beschreibung                                                            | Default                 |
| :------------------- | :------ | :---------------------------------------------------------------------- | :---------------------- |
| `HQ_ISSUE_ID`        | Ja      | Positive Ganzzahl des bearbeiteten GitHub-Issues (z. B. `105`)          | _(keiner)_              |
| `HQ_TEAM`            | Ja      | Team-Kennung (`frontend`, `backend`, `qa`)                              | _(keiner)_              |
| `HQ_ASK`             | Nein    | Absoluter Pfad zu `hq-ask.sh`, von `delegate.sh` für den Worker gesetzt | _(keiner)_              |
| `AGENT_HQ_URL`       | Nein    | Basis-URL der Agent-HQ-Instanz                                          | `http://127.0.0.1:3333` |
| `HQ_CONNECT_TIMEOUT` | Nein    | Verbindungs-Timeout für curl in Sekunden                                | `2`                     |
| `HQ_MAX_TIME`        | Nein    | Maximales Request-Timeout für curl in Sekunden                          | `10`                    |

Fehlt `HQ_ISSUE_ID` oder `HQ_TEAM` oder ist `HQ_ISSUE_ID` keine positive Ganzzahl, bricht `hq-ask.sh` mit Exit 1 ab, ohne einen Request zu senden.

---

## 2. Verwendung

```bash
"$HQ_ASK" "<Frage>" [--option "<Option A>" --option "<Option B>" ...]
```

> **Wichtig:** Führe den Aufruf als genau diesen einen einzelnen Befehl aus. Nicht mit `&&` oder `;` verketten (verkettete Aufrufe bleiben in der Sandbox und scheitern).

### Argumente & Optionen

- `<Frage>` (Pflicht): Der Fragetext als erstes positionales Argument.
- `--option <Wert>` (Optional, wiederholbar): Vordefinierte Antwortmöglichkeiten für den User.

### Beispiele

Rückfrage ohne Optionen:

```bash
"$HQ_ASK" "Soll für das Routing SvelteKit 2 Shallow Routing verwendet werden?"
```

Rückfrage mit Optionen:

```bash
"$HQ_ASK" "Welche Farbpalette soll als Default gesetzt werden?" \
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
- **Timeouts:** Rückfragen müssen zuverlässig ankommen, da der Server in Redis schreibt und ein GitHub-Label setzt. Standardmäßig gelten `--connect-timeout 2` und `--max-time 10` (über `HQ_CONNECT_TIMEOUT` und `HQ_MAX_TIME` überschreibbar).

---

## 5. Claude-Sandbox & Sicherheit

Die Claude-Sandbox blockiert standardmäßig Zugriffe auf `localhost` (Port 3333 für Agent-HQ). `allowedDomains` wirkt nicht auf IP-Adressen oder `localhost`, und ein pauschales `allowLocalBinding` würde alle lokalen Dienste einschließlich Redis freigeben.

Deshalb wird ausschließlich `hq-ask.sh` aus dem nicht beschreibbaren Haupt-Checkout außerhalb der Sandbox ausgeführt:

- `delegate.sh` ermittelt den absoluten Pfad zu `hq-ask.sh` (`ASK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hq-ask.sh"`).
- Liegt dieser Pfad **nicht** unter dem aktuellen Arbeitsverzeichnis `$PWD`, wird er in die Claude-Settings als Ausnahme aufgenommen (`sandbox.excludedCommands: ["<ASK> *"]` und `permissions.allow: ["Bash(<ASK> *)"]`) und `HQ_ASK="<ASK>"` für den Worker exportiert.
- Liegt der Pfad hingegen unter `$PWD`, schließt `delegate.sh` das Skript nicht aus (hq-ask scheitert dann bewusst in der Sandbox) und gibt eine Warnung auf `stderr` aus. Dies schützt davor, dass ein Worker das Skript manipulieren und unsandboxed ausführen kann.
