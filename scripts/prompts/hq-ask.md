# Rückfragen an den User (Agent-HQ)

Wenn während der Bearbeitung eines Tickets eine Spezifikation fehlt, Anforderungen unklar sind oder eine wesentliche architektonische Designentscheidung getroffen werden muss, die nicht eigenständig entschieden werden kann:

1. Stelle eine strukturierte Rückfrage über `scripts/hq-ask.sh`:

   ```bash
   scripts/hq-ask.sh "<Frage>" [--option "<Option A>" --option "<Option B>" ...]
   ```

2. **Wichtig: Beende dich unmittelbar danach!**
   - Nimm nach erfolgreichem Aufruf keine weiteren Datei- oder Codeänderungen vor.
   - Triff keine ungeklärten Annahmen über die fehlende Entscheidung.
   - Dein Lauf wird in Agent-HQ als pausierter Job hinterlegt und nach der Antwort des Users fortgesetzt.
