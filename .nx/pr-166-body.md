Closes #166

## Was
- Die Typen der Server-API liegen jetzt als reine Typ-Exports in `libs/queue/src/types.ts`: `Agent`, `Room`, `EventType`, `EventData`, `HQEvent`, `AgentStatus`, `AgentState`, `RunStatus`, `Run`, `TeamStatus`, `TeamState`, `ActivePR`, `HQState`, `InternalAction`, `StreamUpdatePayload`, `RepoEntry`, `QueueState`, `QueueCounts`, `DraftPR`, `RepoStats`, `RepoStatsResponse`, `HistoryRun` und `HistoryRunItem`. Die Datei hat keine `import`-Zeile.
- `state.ts`, `repo-stats.ts`, `repos.ts`, `history.ts` und `worker-pool.ts` importieren diese Typen und reichen sie für interne Aufrufer per Typ-Re-Export weiter. `eventRooms` wird mit `satisfies Record<EventType, Room>` geprüft, `QUEUE_STATES` mit `satisfies readonly QueueState[]`.
- Die Web-UI importiert nur noch aus `@agent-hq/queue/types`. Ausgenommen sind einige Tests, die den Re-Export aus `server/state` nutzen. `RepoEntryData` entfällt zugunsten von `RepoEntry`. `RoomId` ist jetzt ein Alias auf `Room`, und der `UPDATE`-Handler nutzt `StreamUpdatePayload`.
- `apps/agent-hq-tui/src/api/types.ts` enthält nur noch `AGENTS` und `SSEMessage`. `RepoItem` wird durch `RepoStats` ersetzt, `AgentSlotState` durch `AgentState`. Die Typen `ActivePR` und `DraftPR` sind jetzt die gemeinsamen.
- Typtests in den Routen:
  - `satisfies`-Prüfungen in `sse.ts` (`HQState`, `StreamUpdatePayload`), `/api/repos` (`RepoEntry[]`, `RepoEntry`), `/api/repos/stats` (`RepoStatsResponse`) und `/api/questions` (`QuestionPayload[]`, `QuestionPayload`).
  - `/api/history` nutzt eine Typannotation (`items: HistoryRunItem[]`) mit dem gemeinsamen Typ.

## Aufgedeckte Abweichungen (Verhalten unverändert)
- `UPDATE` auf `/api/stream` überträgt auch `InternalAction`s (`TICK`, `SET_TEAM_STATUSES` …). Deshalb liegt `InternalAction` mit im Vertrag. Die TUI prüft jetzt mit `'event' in event`, ob es sich um ein Ereignis handelt. Vorher war die Bedingung für Actions ohnehin falsch.
- Das `TeamStatus` der TUI kannte `cooldown`, das der Server nie sendet. Der Wert entfällt. `statusColor` nimmt weiterhin einen `string` entgegen.

## Nachtrag aus dem Review von PR #165
- `JobsView`: `innerWidth = columns - 7`. Das ergibt sich aus App-Padding 2, Rahmen 2 und `paddingX` 2, plus 1 Spalte, weil die gestylte Jobzeile laut Messung eine Spalte vor der berechneten Breite umbricht. Vorher galt `- 8`.
- Der 80-Spalten-Test bildet jetzt das App-Layout nach (`flexDirection="column"`, `padding={1}`). Er prüft, dass der Status in derselben Zeile steht und dass `tihofman/agent-hq` an der Breitengrenze nicht gekürzt wird. Mit `- 8` schlägt der Test fehl, das ist verifiziert.
- Der Kill-Guard-Test läuft als `it.each(['complete', 'cooldown'])`.
- ⚠️ **Einschränkung:** Bei einer echten runId aus `delegate.sh` (`1761390000-12345-1`, Issue `#166`) belegen die übrigen Spalten der Zeile 71 von 73 Zeichen. Das Repo wird deshalb weiterhin auf `tih…` gekürzt, und der Status bricht um. Der korrigierte Rand allein behebt das ursprüngliche Symptom bei echten Läufen also nicht. Vorschlag für ein Folge-Ticket: das Zeilenlayout umbauen, zum Beispiel runId kürzen oder in eine zweite Zeile verschieben und das Label `Repo:` entfernen.

## Beleg: keine doppelten Definitionen
Die Suche erfasst nur Definitionen (`interface X` / `type X =`):
```
$ grep -rnE "(interface (NAMES)\b|type (NAMES)[[:space:]]*=)" apps libs --include='*.ts' --include='*.tsx' --include='*.svelte'
# NAMES = Agent|Room|RoomId|EventType|EventData|HQEvent|AgentStatus|AgentState|AgentSlotState|RunStatus|Run|TeamStatus|TeamState|ActivePR|HQState|State|InternalAction|StreamUpdatePayload|RepoEntry|RepoEntryData|RepoItem|QueueState|QueueCounts|DraftPR|RepoStats|RepoStatsResponse|HistoryRun|HistoryRunItem|QuestionPayload
apps/agent-hq/src/lib/office/layout.ts:5:export type RoomId = Room;
apps/agent-hq/src/lib/server/multi-repo.test.ts:36:type State = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
apps/agent-hq/src/lib/server/state.ts:31:export type State = HQState;
apps/agent-hq/src/routes/api/repos/stats/+server.test.ts:31:type State = 'waiting' | 'active' | 'delayed' | 'failed' | 'completed';
libs/queue/src/types.ts:8:export interface QuestionPayload {
libs/queue/src/types.ts:41:export type Agent = 'claude' | 'agy' | 'codex';
libs/queue/src/types.ts:42:export type Room = 'ceo' | 'hall' | 'dev' | 'qa' | 'lounge';
libs/queue/src/types.ts:44:export type EventType =
libs/queue/src/types.ts:64:export interface EventData {
libs/queue/src/types.ts:86:export type HQEvent = {
libs/queue/src/types.ts:100:export type AgentStatus =
libs/queue/src/types.ts:109:export interface AgentState {
libs/queue/src/types.ts:116:export type RunStatus =
libs/queue/src/types.ts:124:export interface Run {
libs/queue/src/types.ts:139:export type TeamStatus = 'idle' | 'working' | 'waiting_input';
libs/queue/src/types.ts:140:export interface TeamState {
libs/queue/src/types.ts:144:export type ActivePR = EventData & {
libs/queue/src/types.ts:150:export interface HQState {
libs/queue/src/types.ts:159:export type InternalAction =
libs/queue/src/types.ts:168:export interface StreamUpdatePayload {
libs/queue/src/types.ts:174:export interface RepoEntry {
libs/queue/src/types.ts:180:export type QueueState = 'waiting' | 'active' | 'delayed' | 'failed';
libs/queue/src/types.ts:181:export type QueueCounts = Record<QueueState, number>;
libs/queue/src/types.ts:183:export interface DraftPR {
libs/queue/src/types.ts:189:export interface RepoStats {
libs/queue/src/types.ts:198:export interface RepoStatsResponse {
libs/queue/src/types.ts:203:export interface HistoryRun extends Run {
libs/queue/src/types.ts:210:export interface HistoryRunItem extends HistoryRun {
```
- `RoomId = Room` und `State = HQState` sind Aliase und keine eigenen Definitionen.
- `type State` in `multi-repo.test.ts` und `repos/stats/+server.test.ts` ist ein testlokaler BullMQ-Job-Zustand, also ein anderer Begriff.

## Checks
Die Checks liefen lokal und direkt pro Projekt, weil `nx run-many` in der Sandbox am Socket des Nx-Daemons scheitert.
- agent-hq:
  - `eslint .` ✅
  - `svelte-check`: 0 Fehler ✅
  - `vite build` + `scripts/check-client-bundle.sh` ✅
  - `vitest run`: 618 ✅, 1 ❌. Der Fehler in `hooks.server.test.ts > ticks every 5 seconds only during cooldown` tritt in der Sandbox auch auf dem Basis-Commit ohne diese Änderungen auf. Ursache ist `connect EPERM 127.0.0.1:6379`: Redis ist nicht erreichbar, und dadurch entstehen zusätzliche Reconnect-Timer. Bitte in der CI bzw. lokal gegenprüfen.
- agent-hq-tui: lint ✅, typecheck ✅, test 20/20 ✅, build ✅
- queue: lint ✅, typecheck ✅, test 21/21 ✅
- `npx nx format:check` ✅

🤖 Generated with [Claude Code](https://claude.com/claude-code)
