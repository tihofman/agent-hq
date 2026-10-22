# Verwendete Tools & Toolchain

Übersicht aller im Projekt `agent-hq` verwendeten Werkzeuge, ihrer Rolle in der Architektur und ihres Verwendungszwecks.

---

## Übersicht der Werkzeuge

| Tool          | Kategorie               | Zweck im Projekt                                                                                                                                              |
| :------------ | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node.js**   | Laufzeitumgebung        | JavaScript/TypeScript-Laufzeitumgebung (v24+) für Server, Build-Prozesse und Backend-Logik.                                                                   |
| **npm**       | Paketverwaltung         | Paketmanager zur Installation, Aktualisierung und Verwaltung von Projektabhängigkeiten (`package.json`, `package-lock.json`).                                 |
| **Nx**        | Monorepo-Orchestrierung | Task-Runner und Workspace-Management; verwaltet Projekt-Targets (`build`, `start`, `serve`, `lint`, `test`, `typecheck`).                                     |
| **SvelteKit** | Fullstack-Framework     | Modernes Webframework für das Agent-HQ-Dashboard inklusive Server-Sent Events (`/api/stream`), Ingest-API (`/api/events`) und Prozesssteuerung (`/api/kill`). |
| **Vite**      | Bundler & Dev-Server    | Schneller Entwicklungs-Server mit Hot Module Replacement (HMR) sowie Produktions-Bundler für SvelteKit.                                                       |
| **Vitest**    | Test-Runner             | Schneller Unit- und Komponenten-Testrunner für TypeScript- und Frontend-Komponenten.                                                                          |
| **Tailwind**  | Styling                 | Utility-First CSS-Framework (v4) zur Umsetzung der responsiven 16-Bit Pixel-Art Benutzeroberfläche.                                                           |
| **ESLint**    | Statische Analyse       | Linter zur Sicherstellung einheitlicher Codequalität und Auffinden von Syntax- und Logikproblemen in TS- und Svelte-Dateien.                                  |
| **Prettier**  | Code-Formatierung       | Meinungsstarker Formatter für einheitliche Code- und Dokumentationsformatierung (TS, Svelte, JSON, Markdown).                                                 |
| **jq**        | JSON-Verarbeitung       | Leichtgewichtiger CLI-JSON-Prozessor für Bash-Skripte (`delegate.sh`, `hq-hook.sh`) zur sicheren Payload-Generierung und -Filterung.                          |
| **gh**        | GitHub CLI              | Schnittstelle zu GitHub für Issue-Tracking, Pull Requests, CI-Statusprüfungen (`gh pr checks`) und Review-Abläufe.                                            |
| **curl**      | HTTP-Client             | Robuster HTTP-Kommandozeilen-Client für fehlertolerantes Senden von Lifecycle-Events an die Ingest-API.                                                       |
| **git**       | Versionskontrolle       | Quellcode- und Branch-Verwaltung mit parallelem Git-Worktree-Workflow für isolierte Feature-Entwicklung.                                                      |
| **agy**       | Subagent / Worker       | Antigravity CLI (Google Gemini) als autonomer Worker-Agent zur Implementierung von Tickets im Hintergrund.                                                    |
| **codex**     | Subagent / Worker       | Codex CLI (OpenAI GPT) als alternativer Worker-Agent für algorithmische Aufgaben und Reviews.                                                                 |

---

## Werkzeug-Kategorien im Detail

### 1. Laufzeit & Monorepo

- **Node.js**: Führt die gebaute Anwendung (`node build` via `@sveltejs/adapter-node`) sowie Build- und Test-Skripte aus.
- **npm**: Stellt reproduzierbare Builds via `npm ci` sicher.
- **Nx**: Ermöglicht target-basierte Caching- und Pipeline-Ausführungen (`npx nx run-many`).

### 2. Fullstack & UI

- **SvelteKit & Vite**: Stellen reactive Komponenten (Pixel-Art Grid, Live-Feed, Ticket-Inspector) sowie API-Endpunkte mit Node-Adapter bereit.
- **Tailwind**: Definiert Pixel-Art Styles (`image-rendering: pixelated;`), Animationen und Status-Badges.

### 3. Qualitätssicherung & Formatierung

- **Vitest**: Führt automatisierte Komponententests und Backend-Routen-Tests aus.
- **ESLint & Prettier**: Automatisieren Formatierung und statische Typprüfungen für reproduzierbare Code-Hygiene.

### 4. CLI, Skripte & Automation

- **jq & curl**: Bilden das Fundament für `scripts/delegate.sh` und `scripts/hq-hook.sh`. Beide nutzen kurze Timeouts (`--connect-timeout 0.1 --max-time 0.5`) für Offline-Resilience (Graceful Degradation).
- **gh**: Ermöglicht die nahtlose Überwachung von Pull Requests und automatisches Melden von Statusänderungen in das Dashboard.
- **git**: Unterstützt isolierte Worktrees (`.worktrees/feat-...`), sodass mehrere Agenten zeitgleich auf separaten Branches arbeiten können.

### 5. Multi-Agenten-Workflow

- **agy** & **codex**: Werden von Claude Code über `scripts/delegate.sh` gesteuert. Sie führen Entwicklungsaufgaben im Hintergrund aus und melden Fortschritt sowie Status automatisch an Agent-HQ.
