# Entwicklungs-Setup & Grundlagen

## Voraussetzungen

- Node.js (via nvm)
- Docker / Colima
- Nx CLI (`npx nx`)

## Erste Schritte

```bash
# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npx nx serve <app-name>

# Tests ausführen
npx nx test <app-name>
```

## Branching & Worktree-Strategie

Alle Features werden über Git Worktrees entwickelt:

```bash
git worktree add -b feat/<TICKET_ID>-<slug> .worktrees/feat-<TICKET_ID>-<slug> main
```
