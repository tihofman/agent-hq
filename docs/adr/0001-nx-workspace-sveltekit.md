# ADR 0001: Nx Workspace mit einer SvelteKit-App (UI + Server)

## Status

Accepted (2026-10-22)

## Kontext

Agent-HQ braucht ein Browser-Frontend (Virtual Office, Live-Feed, Ticket-Tracker) und einen lokalen Server (Event Ingest, State Machine, Log-Tailer, SSE, Kill Switch). Alle Repositories folgen dem Nx-Monorepo-Standard (`apps/`, `libs/`). Für kleinere Fullstack-Projekte ist Svelte/SvelteKit der Standard-Stack. Das System läuft rein lokal auf einem Rechner, für einen Nutzer.

## Entscheidung

- Das Repository ist ein **Nx Workspace**.
- Es gibt **eine** SvelteKit-App `apps/agent-hq`, die UI und Server enthält:
  - UI unter `src/routes/` und `src/lib/components/`,
  - Serverlogik unter `src/lib/server/` (`state.ts`, `tail.ts`, `history.ts`, `sse.ts`),
  - API-Endpunkte als SvelteKit-Routen (`/api/events`, `/api/stream`, `/api/kill`).
- Styling mit TailwindCSS.
- Kein separates Backend (kein Kotlin/Python-Service), keine eigenen `libs/`, solange es nur eine App gibt.

## Konsequenzen

### Positiv

- Ein Prozess, ein Build, ein Start (`nx serve agent-hq`), ein Port (`3333`).
- Event-Typen und State-Modell werden von Server und UI gemeinsam in TypeScript genutzt, ohne Schnittstellen-Duplikat.
- Konsistent mit dem Workspace-Standard; Nx-Tooling (format, lint, test) steht direkt zur Verfügung.

### Negativ / Trade-offs

- Nx bringt für eine einzelne App spürbaren Tooling-Überbau mit.
- UI und Server sind gekoppelt deploybar; ein getrennter Betrieb wäre ein Umbau (für ein rein lokales Tool nicht nötig).
- Langlebige Server-Ressourcen (`fs.watch`, SSE-Verbindungen, PID-Registry) leben im SvelteKit-Node-Prozess und müssen dort sauber verwaltet werden.
