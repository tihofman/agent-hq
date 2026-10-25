#!/usr/bin/env bash
# Tests für die Moduswahl in run.sh und den Startmodus --tui (scripts/hq-tui.sh).
# tmux, claude, curl, lsof, npm und npx sind gemockt. Der Mock-Zustand liegt in $STATE:
#   session      tmux-Sitzung agent-hq existiert
#   port_busy    lsof meldet einen Listener auf PORT
#   server_up    curl bekommt HTTP 200 von /api/stream
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

TOTAL=0
FAILED=0

pass() {
  TOTAL=$((TOTAL + 1))
  echo "PASS: $*"
}

fail() {
  TOTAL=$((TOTAL + 1))
  FAILED=$((FAILED + 1))
  echo "FAIL: $*"
}

# Kopie des Repos mit run.sh, hq-tui.sh, Wrapper und Platzhaltern für node_modules und TUI-Build
FAKE_ROOT="$TEST_DIR/root"
mkdir -p "$FAKE_ROOT/scripts" "$FAKE_ROOT/node_modules" "$FAKE_ROOT/dist/apps/agent-hq-tui"
cp "$ROOT/run.sh" "$FAKE_ROOT/run.sh"
cp "$ROOT/scripts/hq-tui.sh" "$ROOT/scripts/agent-hq" "$FAKE_ROOT/scripts/"
touch "$FAKE_ROOT/dist/apps/agent-hq-tui/main.js"

MOCK_BIN="$TEST_DIR/bin"
STATE="$TEST_DIR/state"
CALLS="$TEST_DIR/calls"
mkdir -p "$MOCK_BIN" "$STATE"

cat <<EOF >"$MOCK_BIN/tmux"
#!/usr/bin/env bash
echo "tmux \$*" >> "$CALLS"
case "\$1" in
  has-session) [ -f "$STATE/session" ]; exit \$? ;;
  new-session)
    touch "$STATE/session"
    # Ein im Fenster "server" gestarteter Server antwortet sofort
    case " \$* " in *" -n server "*) [ -f "$STATE/server_never_up" ] || touch "$STATE/server_up" ;; esac
    ;;
  split-window) case " \$* " in *" -P "*) echo "%1" ;; esac ;;
esac
exit 0
EOF

cat <<EOF >"$MOCK_BIN/curl"
#!/bin/sh
echo "curl \$*" >> "$CALLS"
if [ -f "$STATE/server_up" ]; then printf 200; exit 28; fi
printf 000; exit 7
EOF

cat <<EOF >"$MOCK_BIN/lsof"
#!/bin/sh
if [ -f "$STATE/port_busy" ]; then
  echo "node 4711 user 20u IPv4 TCP 127.0.0.1:3333 (LISTEN)"
  exit 0
fi
exit 1
EOF

for cmd in claude npm npx docker; do
  cat <<EOF >"$MOCK_BIN/$cmd"
#!/bin/sh
echo "$cmd \$*" >> "$CALLS"
[ "$cmd" != docker ] || [ "\$1" != info ] || exit 1
exit 0
EOF
done
chmod +x "$MOCK_BIN"/*

CLAUDE_CFG="$TEST_DIR/claude-config"
mkdir -p "$CLAUDE_CFG/skills/agent-hq"
touch "$CLAUDE_CFG/skills/agent-hq/SKILL.md"

CALLER="$TEST_DIR/caller"
mkdir -p "$CALLER"

OUT="$TEST_DIR/out"
EXIT_CODE=0

reset_state() {
  rm -f "$STATE"/* "$CALLS"
  touch "$CALLS"
}

# run_hq <args...>: startet ein Kommando aus $CALLER mit gemocktem PATH, ohne TTY.
run_hq() {
  (cd "$CALLER" && env -u TMUX PATH="$MOCK_BIN:$PATH" CLAUDE_CONFIG_DIR="$CLAUDE_CFG" \
    AGENT_HQ_SERVER_LOG="$TEST_DIR/server.log" RUN_SH_SERVER_SLEEP=0.01 "$@") </dev/null >"$OUT" 2>&1
  EXIT_CODE=$?
}

calls() { cat "$CALLS"; }

# -----------------------------------------------------------------------------
# Moduswahl
# -----------------------------------------------------------------------------
reset_state
run_hq env RUN_SH_DRY_RUN=1 PORT=3999 bash "$FAKE_ROOT/run.sh"
if [ "$EXIT_CODE" -eq 0 ] && grep -q "erfolgreich" "$OUT" && ! grep -q "^tmux" "$CALLS"; then
  pass "Ohne Flag und ohne TTY gilt --web (heutiges Verhalten)"
else
  fail "Nicht-TTY-Default sollte --web sein (Exit $EXIT_CODE, Ausgabe: $(cat "$OUT"), Aufrufe: $(calls))"
fi

reset_state
run_hq env RUN_SH_DRY_RUN=1 PORT=3999 bash "$FAKE_ROOT/run.sh" --web
if [ "$EXIT_CODE" -eq 0 ] && grep -q "Pre-flight-Prüfung für Port 3999 erfolgreich" "$OUT" && ! grep -q "^tmux" "$CALLS"; then
  pass "run.sh --web verhält sich wie run.sh ohne Flag"
else
  fail "run.sh --web (Exit $EXIT_CODE, Ausgabe: $(cat "$OUT"))"
fi

reset_state
(cd "$CALLER" && PATH="$MOCK_BIN:$PATH" RUN_SH_ASSUME_TTY=1 RUN_SH_DRY_RUN=1 PORT=3999 bash "$FAKE_ROOT/run.sh" <<<"w") >"$OUT" 2>&1
EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 0 ] && grep -q "\[w\]eb / \[t\]ui" "$OUT" && grep -q "erfolgreich" "$OUT"; then
  pass "Interaktive Auswahl 'w' startet den Web-Modus"
else
  fail "Interaktive Auswahl 'w' (Exit $EXIT_CODE, Ausgabe: $(cat "$OUT"))"
fi

reset_state
(cd "$CALLER" && env -u TMUX PATH="$MOCK_BIN:$PATH" CLAUDE_CONFIG_DIR="$CLAUDE_CFG" RUN_SH_ASSUME_TTY=1 \
  AGENT_HQ_SERVER_LOG="$TEST_DIR/server.log" bash "$FAKE_ROOT/run.sh" <<<"t") >"$OUT" 2>&1
EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 0 ] && grep -q "^tmux attach-session -t agent-hq" "$CALLS"; then
  pass "Interaktive Auswahl 't' startet den TUI-Modus"
else
  fail "Interaktive Auswahl 't' (Exit $EXIT_CODE, Ausgabe: $(cat "$OUT"), Aufrufe: $(calls))"
fi

reset_state
(PATH="$MOCK_BIN:$PATH" RUN_SH_ASSUME_TTY=1 bash "$FAKE_ROOT/run.sh" <<<"x") >"$OUT" 2>&1
EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 1 ] && ! grep -q "^tmux" "$CALLS"; then
  pass "Unbekannte interaktive Auswahl -> Exit 1"
else
  fail "Unbekannte Auswahl erwartete Exit 1, bekam $EXIT_CODE"
fi

reset_state
run_hq bash "$FAKE_ROOT/run.sh" --foo
if [ "$EXIT_CODE" -eq 1 ] && grep -q -- "--foo" "$OUT"; then
  pass "Unbekannte Option -> Exit 1 mit Meldung"
else
  fail "Unbekannte Option erwartete Exit 1, bekam $EXIT_CODE (Ausgabe: $(cat "$OUT"))"
fi

reset_state
run_hq bash "$FAKE_ROOT/scripts/agent-hq" --tui
if [ "$EXIT_CODE" -eq 0 ] && grep -q "^tmux attach-session -t agent-hq" "$CALLS"; then
  pass "Wrapper scripts/agent-hq reicht --tui an run.sh durch"
else
  fail "Wrapper scripts/agent-hq --tui (Exit $EXIT_CODE, Ausgabe: $(cat "$OUT"))"
fi

# -----------------------------------------------------------------------------
# Abbruch ohne tmux
# -----------------------------------------------------------------------------
NO_TMUX_BIN="$TEST_DIR/bin_no_tmux"
mkdir -p "$NO_TMUX_BIN"
for cmd in bash dirname; do
  ln -sf "$(command -v "$cmd")" "$NO_TMUX_BIN/$cmd"
done
(cd "$CALLER" && PATH="$NO_TMUX_BIN" bash "$FAKE_ROOT/run.sh" --tui) </dev/null >"$OUT" 2>&1
EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 1 ] && grep -q "tmux fehlt" "$OUT" && grep -q "brew install tmux" "$OUT"; then
  pass "Ohne tmux -> Exit 1 mit Installationshinweis"
else
  fail "Ohne tmux erwartete Exit 1 mit Hinweis, bekam $EXIT_CODE (Ausgabe: $(cat "$OUT"))"
fi

# -----------------------------------------------------------------------------
# Bestehende Sitzung wird wiederverwendet
# -----------------------------------------------------------------------------
reset_state
touch "$STATE/session"
run_hq bash "$FAKE_ROOT/run.sh" --tui
if [ "$EXIT_CODE" -eq 0 ] && grep -q "^tmux attach-session -t agent-hq" "$CALLS" && ! grep -q "^tmux new-session" "$CALLS"; then
  pass "Laufende Sitzung agent-hq -> nur anhängen, keine zweite Sitzung"
else
  fail "Laufende Sitzung (Exit $EXIT_CODE, Aufrufe: $(calls))"
fi

reset_state
touch "$STATE/session"
(cd "$CALLER" && PATH="$MOCK_BIN:$PATH" TMUX=/tmp/fake,1,0 bash "$FAKE_ROOT/run.sh" --tui) </dev/null >"$OUT" 2>&1
EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 0 ] && grep -q "^tmux switch-client -t agent-hq" "$CALLS"; then
  pass "Innerhalb von tmux -> switch-client statt attach"
else
  fail "Innerhalb von tmux (Exit $EXIT_CODE, Aufrufe: $(calls))"
fi

# -----------------------------------------------------------------------------
# Frischer Start: Server im Fenster "server", Layout, Env-Durchreichen
# -----------------------------------------------------------------------------
reset_state
run_hq env AGENT_HQ_V2_WORKERS=1 PORT=3999 bash "$FAKE_ROOT/run.sh" --tui
SERVER_LINE="$(grep "^tmux new-session" "$CALLS" || true)"
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "Frischer Start erwartete Exit 0, bekam $EXIT_CODE (Ausgabe: $(cat "$OUT"))"
elif ! echo "$SERVER_LINE" | grep -q -- "-n server .*hq-tui.sh _server"; then
  fail "Server-Fenster fehlt (Aufrufe: $(calls))"
else
  pass "Freier Port -> Server startet im tmux-Fenster server"
fi

if echo "$SERVER_LINE" | grep -q -- "-e AGENT_HQ_V2_WORKERS=1" &&
  echo "$SERVER_LINE" | grep -q -- "-e PORT=3999" &&
  echo "$SERVER_LINE" | grep -q -- "-e AGENT_HQ_URL=http://127.0.0.1:3999"; then
  pass "AGENT_HQ_V2_WORKERS, PORT und AGENT_HQ_URL werden an die Sitzung durchgereicht"
else
  fail "Env-Variablen fehlen in new-session: $SERVER_LINE"
fi

if grep -q "^tmux pipe-pane -t agent-hq:server -o cat >> .*server.log" "$CALLS" &&
  grep -q "^curl .*http://127.0.0.1:3999/api/stream" "$CALLS"; then
  pass "Server-Log wird mitgeschrieben, Start wartet auf /api/stream"
else
  fail "pipe-pane oder Warten auf /api/stream fehlt (Aufrufe: $(calls))"
fi

SPLITS="$(grep -c "^tmux split-window" "$CALLS" || true)"
CLAUDE_LINE="$(grep "^tmux split-window -h" "$CALLS" || true)"
LOG_LINE="$(grep "^tmux split-window -v -f" "$CALLS" || true)"
if grep -q "^tmux new-window -d -t agent-hq -n hq -c $CALLER node .*apps/agent-hq-tui/bin/agent-hq-tui.js" "$CALLS" &&
  [ "$SPLITS" = "2" ] &&
  echo "$CLAUDE_LINE" | grep -q -- "-t agent-hq:hq -c $CALLER claude$" &&
  echo "$LOG_LINE" | grep -q "tail -n 200 -F .*server.log"; then
  pass "Layout: 3 Panes (TUI links, claude rechts im Aufrufverzeichnis, Log unten)"
else
  fail "Layout falsch (Aufrufe: $(calls))"
fi

if grep -q -- "--dangerously-skip-permissions" "$CALLS"; then
  fail "claude wird mit --dangerously-skip-permissions gestartet"
else
  pass "claude startet ohne --dangerously-skip-permissions"
fi

if grep -q "^tmux select-pane -t %1" "$CALLS" && tail -n 1 "$CALLS" | grep -q "^tmux attach-session -t agent-hq"; then
  pass "Fokus auf claude, danach attach"
else
  fail "Fokus/attach fehlt (Aufrufe: $(calls))"
fi

# -----------------------------------------------------------------------------
# Laufender Server wird wiederverwendet, fremder Prozess auf dem Port bricht ab
# -----------------------------------------------------------------------------
reset_state
touch "$STATE/port_busy" "$STATE/server_up"
run_hq bash "$FAKE_ROOT/run.sh" --tui
if [ "$EXIT_CODE" -eq 0 ] && ! grep -q -- "-n server" "$CALLS" && ! grep -q "pipe-pane" "$CALLS" &&
  grep -q "^tmux new-session -d -s agent-hq -n hq -c $CALLER" "$CALLS"; then
  pass "Laufender Server mit /api/stream -> wiederverwendet, kein Doppelstart"
else
  fail "Server-Wiederverwendung (Exit $EXIT_CODE, Aufrufe: $(calls))"
fi

reset_state
touch "$STATE/port_busy"
run_hq bash "$FAKE_ROOT/run.sh" --tui
if [ "$EXIT_CODE" -eq 1 ] && grep -q "belegt" "$OUT" && ! grep -q "^tmux new-session" "$CALLS"; then
  pass "Port belegt ohne /api/stream -> Exit 1, keine Sitzung, kein Serverstart"
else
  fail "Belegter Port (Exit $EXIT_CODE, Ausgabe: $(cat "$OUT"), Aufrufe: $(calls))"
fi

reset_state
touch "$STATE/server_never_up"
run_hq env RUN_SH_SERVER_ATTEMPTS=3 bash "$FAKE_ROOT/run.sh" --tui
if [ "$EXIT_CODE" -eq 0 ] && grep -q "Warnung: Server antwortet noch nicht" "$OUT" && grep -q "^tmux attach-session" "$CALLS"; then
  pass "Server antwortet nicht rechtzeitig -> Warnung, Sitzung startet trotzdem"
else
  fail "Warte-Timeout (Exit $EXIT_CODE, Ausgabe: $(cat "$OUT"))"
fi

# -----------------------------------------------------------------------------
# Skill-Prüfung
# -----------------------------------------------------------------------------
reset_state
run_hq bash "$FAKE_ROOT/run.sh" --tui
if ! grep -q "Skill agent-hq fehlt" "$OUT"; then
  pass "Installierter Skill -> kein Hinweis"
else
  fail "Hinweis trotz installiertem Skill (Ausgabe: $(cat "$OUT"))"
fi

EMPTY_CFG="$TEST_DIR/claude-empty"
mkdir -p "$EMPTY_CFG"
reset_state
run_hq env CLAUDE_CONFIG_DIR="$EMPTY_CFG" bash "$FAKE_ROOT/run.sh" --tui
if [ "$EXIT_CODE" -eq 0 ] && grep -q "Skill agent-hq fehlt" "$OUT" && grep -q "npx skills add tihofman/agent-hq" "$OUT" &&
  ! grep -q "^npx skills" "$CALLS"; then
  pass "Fehlender Skill -> Hinweis mit Installationsbefehl, nichts installiert"
else
  fail "Skill-Hinweis fehlt (Exit $EXIT_CODE, Ausgabe: $(cat "$OUT"))"
fi

PLUGIN_CFG="$TEST_DIR/claude-plugin"
mkdir -p "$PLUGIN_CFG/plugins"
echo '{"version":2,"plugins":{"agent-hq@agent-hq":[]}}' >"$PLUGIN_CFG/plugins/installed_plugins.json"
reset_state
run_hq env CLAUDE_CONFIG_DIR="$PLUGIN_CFG" bash "$FAKE_ROOT/run.sh" --tui
if ! grep -q "Skill agent-hq fehlt" "$OUT"; then
  pass "Als Plugin installierter Skill wird erkannt"
else
  fail "Plugin-Installation nicht erkannt (Ausgabe: $(cat "$OUT"))"
fi

# -----------------------------------------------------------------------------
# Fehlender TUI-Build wird gebaut
# -----------------------------------------------------------------------------
rm "$FAKE_ROOT/dist/apps/agent-hq-tui/main.js"
reset_state
run_hq bash "$FAKE_ROOT/run.sh" --tui
touch "$FAKE_ROOT/dist/apps/agent-hq-tui/main.js"
if [ "$EXIT_CODE" -eq 0 ] && grep -q "^npx nx run agent-hq-tui:build" "$CALLS"; then
  pass "Fehlender TUI-Build -> npx nx run agent-hq-tui:build"
else
  fail "TUI-Build wurde nicht ausgelöst (Exit $EXIT_CODE, Aufrufe: $(calls))"
fi

# -----------------------------------------------------------------------------
# Ende der Sitzung stoppt den selbst gestarteten Server (Wrapper _server)
# -----------------------------------------------------------------------------
STOP_ROOT="$TEST_DIR/stop_root"
mkdir -p "$STOP_ROOT/scripts"
cp "$ROOT/scripts/hq-tui.sh" "$STOP_ROOT/scripts/"
# Fake run.sh (= npx/nx) startet "node" in einer eigenen Prozessgruppe, wie es nx tun kann.
# Den erreicht nur der Kill über den Port-Listener (gemocktes lsof).
cat <<EOF >"$STOP_ROOT/run.sh"
#!/usr/bin/env bash
[ "\$1" = "--web" ] || exit 2
echo "\${NX_TUI:-}" > "$TEST_DIR/nx_tui"
set -m
bash -c 'trap "echo TERM >> $TEST_DIR/node_signal; exit 0" TERM; echo \$\$ > $TEST_DIR/node_pid; while :; do sleep 0.05; done' &
trap 'echo TERM >> "$TEST_DIR/server_signal"; exit 0' TERM
trap 'echo HUP >> "$TEST_DIR/server_signal"; exit 0' HUP
echo \$\$ > "$TEST_DIR/server_pid"
while :; do sleep 0.05; done
EOF
STOP_BIN="$TEST_DIR/bin_stop"
mkdir -p "$STOP_BIN"
cat <<EOF >"$STOP_BIN/lsof"
#!/bin/sh
cat "$TEST_DIR/node_pid" 2>/dev/null
EOF
chmod +x "$STOP_BIN/lsof"

PATH="$STOP_BIN:$PATH" bash "$STOP_ROOT/scripts/hq-tui.sh" _server </dev/null >/dev/null 2>&1 &
WRAPPER_PID=$!
for _ in {1..100}; do
  [ ! -s "$TEST_DIR/server_pid" ] || [ ! -s "$TEST_DIR/node_pid" ] || break
  sleep 0.05
done
FAKE_SERVER_PID="$(cat "$TEST_DIR/server_pid" 2>/dev/null || true)"
FAKE_NODE_PID="$(cat "$TEST_DIR/node_pid" 2>/dev/null || true)"
kill -HUP "$WRAPPER_PID" 2>/dev/null
for _ in {1..100}; do
  kill -0 "$WRAPPER_PID" 2>/dev/null || break
  sleep 0.05
done
sleep 0.2

if [ -z "$FAKE_SERVER_PID" ] || [ -z "$FAKE_NODE_PID" ]; then
  fail "Wrapper hat run.sh --web nicht gestartet"
elif kill -0 "$FAKE_SERVER_PID" 2>/dev/null || kill -0 "$FAKE_NODE_PID" 2>/dev/null; then
  kill "$FAKE_SERVER_PID" "$FAKE_NODE_PID" 2>/dev/null
  fail "Server läuft nach SIGHUP an die Sitzung weiter"
elif [ "$(cat "$TEST_DIR/server_signal" 2>/dev/null)" != "TERM" ] || [ "$(cat "$TEST_DIR/node_signal" 2>/dev/null)" != "TERM" ]; then
  fail "Server bekam nicht SIGTERM (run.sh: $(cat "$TEST_DIR/server_signal" 2>/dev/null), node: $(cat "$TEST_DIR/node_signal" 2>/dev/null))"
else
  pass "Sitzungsende (SIGHUP) stoppt den selbst gestarteten Server samt Port-Listener per SIGTERM"
fi
kill -9 "$WRAPPER_PID" 2>/dev/null || true

if [ "$(cat "$TEST_DIR/nx_tui" 2>/dev/null)" = "false" ]; then
  pass "Server-Fenster startet run.sh --web mit NX_TUI=false (lesbares Log)"
else
  fail "NX_TUI=false fehlt im Server-Fenster"
fi

# -----------------------------------------------------------------------------
# Zusammenfassung
# -----------------------------------------------------------------------------
echo "---"
echo "Tests completed: $TOTAL | Failed: $FAILED"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
