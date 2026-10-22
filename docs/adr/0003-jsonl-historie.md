# ADR 0003: Append-only JSONL-Historie statt SQLite

## Status

Accepted (2026-10-22)

## Kontext

Die UI soll die letzten 20 Läufe (gruppiert nach `runId`) mit Event-Verlauf, Exit-Code und Link aufs Run-Log zeigen. Die Datenmenge ist klein (ein Nutzer, wenige Events pro Lauf). Der aktuelle Zustand wird ohnehin im Speicher gehalten. Abfragen über die Historie sind trivial (letzte N Läufe).

## Entscheidung

- Jedes Event wird als eine JSON-Zeile an `~/.agent-hq/history.jsonl` angehängt (append-only).
- Keine Datenbank (kein SQLite, kein ORM).
- Der aktuelle Zustand liegt im In-Memory State; die Historie wird nur zum Anzeigen vergangener Läufe gelesen.

## Konsequenzen

### Positiv

- Keine native Abhängigkeit, kein Schema, keine Migrationen.
- Datei ist mit Standardwerkzeugen lesbar (`tail`, `jq`, `grep`).
- Anhängen ist einfach und robust; ein abgebrochener Schreibvorgang betrifft höchstens die letzte Zeile.

### Negativ / Trade-offs

- Die Datei wächst unbegrenzt; Rotation oder Kürzung ist bei Bedarf nachzurüsten.
- Lesen der letzten Läufe erfordert Parsen der Datei (bei der erwarteten Größe unkritisch).
- Komplexe Abfragen oder Auswertungen wären mit einer Datenbank einfacher; ein Wechsel wäre eine neue Entscheidung.
