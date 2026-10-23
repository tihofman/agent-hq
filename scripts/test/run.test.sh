#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
LISTENER_PID=

cleanup() {
  if [ -n "$LISTENER_PID" ]; then
    kill "$LISTENER_PID" 2>/dev/null || true
    wait "$LISTENER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

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

# -----------------------------------------------------------------------------
# Test 1/2: Fehlendes Tool führt zu Exit 1 mit verständlicher Meldung
# -----------------------------------------------------------------------------
for missing in jq gh lsof; do
  MOCK_BIN="$TEST_DIR/bin_no_$missing"
  mkdir -p "$MOCK_BIN"
  for cmd in bash sh node npm jq gh lsof dirname basename; do
    [ "$cmd" = "$missing" ] && continue
    p="$(command -v "$cmd" 2>/dev/null || true)"
    [ -z "$p" ] || ln -sf "$p" "$MOCK_BIN/$cmd"
  done

  OUT_FILE="$TEST_DIR/out_no_$missing"
  set +e
  PATH="$MOCK_BIN" RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh" >"$OUT_FILE" 2>&1
  EXIT_CODE=$?
  set -e

  if [ "$EXIT_CODE" -ne 1 ]; then
    fail "Fehlendes Tool ($missing) erwartete Exit 1, bekam $EXIT_CODE"
  elif ! grep -q "$missing" "$OUT_FILE"; then
    fail "Fehlermeldung nennt das fehlende Tool $missing nicht (Ausgabe: $(cat "$OUT_FILE"))"
  else
    pass "Fehlendes Tool $missing -> Exit 1 mit klarer Meldung"
  fi
done

# -----------------------------------------------------------------------------
# Nicht-numerischer PORT führt zu Exit 1
# -----------------------------------------------------------------------------
OUT_FILE="$TEST_DIR/out_bad_port"
set +e
PORT="3484 x" RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh" >"$OUT_FILE" 2>&1
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 1 ] || ! grep -q "numerisch" "$OUT_FILE"; then
  fail "Nicht-numerischer PORT erwartete Exit 1 mit Meldung, bekam $EXIT_CODE (Ausgabe: $(cat "$OUT_FILE"))"
else
  pass "Nicht-numerischer PORT -> Exit 1 mit Meldung"
fi

# -----------------------------------------------------------------------------
# Test 3: Belegter Port führt zu Exit 1 mit Meldung über den belegenden Prozess
# -----------------------------------------------------------------------------
PORT_FILE="$TEST_DIR/busy_port"
node -e '
const net = require("net");
const s = net.createServer();
s.listen(0, "127.0.0.1", () => {
  require("fs").writeFileSync(process.argv[1], String(s.address().port));
});
setInterval(() => {}, 1000);
' "$PORT_FILE" &
LISTENER_PID=$!

for i in {1..50}; do
  [ ! -s "$PORT_FILE" ] || break
  sleep 0.05
done

if [ ! -s "$PORT_FILE" ]; then
  fail "Konnte Test-Listener nicht starten"
else
  BUSY_PORT="$(cat "$PORT_FILE")"
  OUT_FILE="$TEST_DIR/out_busy_port"
  set +e
  PORT="$BUSY_PORT" RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh" >"$OUT_FILE" 2>&1
  EXIT_CODE=$?
  set -e

  BUSY_PID="$LISTENER_PID"
  kill "$LISTENER_PID" 2>/dev/null || true
  wait "$LISTENER_PID" 2>/dev/null || true
  LISTENER_PID=

  if [ "$EXIT_CODE" -ne 1 ]; then
    fail "Belegter Port erwartete Exit 1, bekam $EXIT_CODE (Ausgabe: $(cat "$OUT_FILE"))"
  elif ! grep -q "$BUSY_PORT" "$OUT_FILE"; then
    fail "Fehlermeldung nennt den belegten Port nicht (Ausgabe: $(cat "$OUT_FILE"))"
  elif ! grep -q -i "belegt" "$OUT_FILE"; then
    fail "Fehlermeldung erwähnt 'belegt' nicht (Ausgabe: $(cat "$OUT_FILE"))"
  # lsof shows the command name differently per OS (Linux: "MainThrea"), so check the PID.
  elif ! grep -q "$BUSY_PID" "$OUT_FILE"; then
    fail "Fehlermeldung enthält den belegenden Prozess nicht (Ausgabe: $(cat "$OUT_FILE"))"
  else
    pass "Belegter Port $BUSY_PORT -> Exit 1 mit Prozessinformationen"
  fi
fi

# -----------------------------------------------------------------------------
# Test 4: Freier Port mit RUN_SH_DRY_RUN=1 führt zu Exit 0
# -----------------------------------------------------------------------------
# Wir nutzen denselben Port, der nach dem Beenden des Listeners nun frei ist
OUT_FILE="$TEST_DIR/out_free_port"
set +e
PORT="$BUSY_PORT" RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh" >"$OUT_FILE" 2>&1
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 0 ]; then
  fail "Freier Port erwartete Exit 0, bekam $EXIT_CODE (Ausgabe: $(cat "$OUT_FILE"))"
elif ! grep -q "erfolgreich" "$OUT_FILE"; then
  fail "Erfolgsmeldung fehlt bei freiem Port (Ausgabe: $(cat "$OUT_FILE"))"
else
  pass "Freier Port mit RUN_SH_DRY_RUN=1 -> Exit 0"
fi

# -----------------------------------------------------------------------------
# Test 5: Default-Port ist 3333 (wenn PORT ungesetzt ist)
# -----------------------------------------------------------------------------
OUT_FILE="$TEST_DIR/out_default_port"
set +e
(unset PORT; RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh") >"$OUT_FILE" 2>&1
EXIT_CODE=$?
set -e

if ! grep -q "3333" "$OUT_FILE"; then
  fail "Default-Port 3333 wurde nicht verwendet (Ausgabe: $(cat "$OUT_FILE"))"
else
  pass "Default-Port 3333 wird ohne PORT-Variable verwendet"
fi

# -----------------------------------------------------------------------------
# Test 6: Docker fehlt (Daemon nicht erreichbar) -> Warnung auf stderr, Exit 0
# -----------------------------------------------------------------------------
MOCK_BIN="$TEST_DIR/bin_docker_down"
mkdir -p "$MOCK_BIN"
cat << 'EOF' > "$MOCK_BIN/docker"
#!/bin/sh
if [ "$1" = "info" ]; then
  echo "Cannot connect to the Docker daemon" >&2
  exit 1
fi
exit 0
EOF
chmod +x "$MOCK_BIN/docker"

STDOUT_FILE="$TEST_DIR/out_docker_down_stdout"
STDERR_FILE="$TEST_DIR/out_docker_down_stderr"
set +e
PORT="$BUSY_PORT" PATH="$MOCK_BIN:$PATH" RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh" >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 0 ]; then
  fail "Docker fehlt erwartete Exit 0, bekam $EXIT_CODE (stderr: $(cat "$STDERR_FILE"))"
elif ! grep -q "Warnung: Docker" "$STDERR_FILE"; then
  fail "Warnung auf stderr fehlt bei fehlendem Docker (stderr: $(cat "$STDERR_FILE"))"
elif ! grep -q "erfolgreich" "$STDOUT_FILE"; then
  fail "Erfolgsmeldung fehlt bei fehlendem Docker (stdout: $(cat "$STDOUT_FILE"))"
else
  pass "Docker fehlt -> Warnung auf stderr, Server startet trotzdem (Exit 0)"
fi

# -----------------------------------------------------------------------------
# Test 7: RUN_SH_DRY_RUN=1 startet keine Container (selbst wenn Docker läuft)
# -----------------------------------------------------------------------------
MOCK_BIN="$TEST_DIR/bin_docker_dry_run"
mkdir -p "$MOCK_BIN"
DOCKER_CALLS="$TEST_DIR/docker_calls_dry_run"
cat << EOF > "$MOCK_BIN/docker"
#!/bin/sh
echo "\$@" >> "$DOCKER_CALLS"
if [ "\$1" = "info" ]; then
  exit 0
fi
exit 0
EOF
chmod +x "$MOCK_BIN/docker"

STDOUT_FILE="$TEST_DIR/out_docker_dry_run_stdout"
STDERR_FILE="$TEST_DIR/out_docker_dry_run_stderr"
set +e
PORT="$BUSY_PORT" PATH="$MOCK_BIN:$PATH" RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh" >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 0 ]; then
  fail "Dry-Run mit Docker erwartete Exit 0, bekam $EXIT_CODE"
elif grep -q "compose" "$DOCKER_CALLS" 2>/dev/null; then
  fail "RUN_SH_DRY_RUN=1 rief docker compose auf: $(cat "$DOCKER_CALLS")"
else
  pass "RUN_SH_DRY_RUN=1 startet keine Container trotz aktivem Docker"
fi

# -----------------------------------------------------------------------------
# Test 8: Auto-Start startet Redis via docker compose up -d redis wenn Docker läuft
# -----------------------------------------------------------------------------
MOCK_BIN="$TEST_DIR/bin_docker_start"
mkdir -p "$MOCK_BIN"
DOCKER_CALLS="$TEST_DIR/docker_calls_start"
cat << EOF > "$MOCK_BIN/docker"
#!/bin/sh
echo "\$@" >> "$DOCKER_CALLS"
if [ "\$1" = "info" ]; then
  exit 0
fi
if [ "\$1" = "compose" ] && [ "\$2" = "exec" ]; then
  echo "PONG"
  exit 0
fi
exit 0
EOF
chmod +x "$MOCK_BIN/docker"

# Mock npx so actual nx/node server is not launched
cat << 'EOF' > "$MOCK_BIN/npx"
#!/bin/sh
exit 0
EOF
chmod +x "$MOCK_BIN/npx"

STDOUT_FILE="$TEST_DIR/out_docker_start_stdout"
STDERR_FILE="$TEST_DIR/out_docker_start_stderr"
set +e
PORT="$BUSY_PORT" PATH="$MOCK_BIN:$PATH" RUN_SH_DRY_RUN=0 bash "$ROOT/run.sh" >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 0 ]; then
  fail "Docker Start erwartete Exit 0, bekam $EXIT_CODE (stderr: $(cat "$STDERR_FILE"))"
elif ! grep -q "compose up -d redis" "$DOCKER_CALLS" 2>/dev/null; then
  fail "docker compose up -d redis wurde nicht aufgerufen (Aufrufe: $(cat "$DOCKER_CALLS" 2>/dev/null))"
elif ! grep -q "Redis ist bereit" "$STDOUT_FILE"; then
  fail "Erfolgsmeldung 'Redis ist bereit' fehlt (stdout: $(cat "$STDOUT_FILE"))"
else
  pass "run.sh startet Redis automatisch via docker compose up -d redis wenn Docker läuft"
fi

# -----------------------------------------------------------------------------
# Test 9: Redis antwortet nicht auf ping -> Warnung auf stderr, Server startet trotzdem
# -----------------------------------------------------------------------------
MOCK_BIN="$TEST_DIR/bin_docker_timeout"
mkdir -p "$MOCK_BIN"
cat << 'EOF' > "$MOCK_BIN/docker"
#!/bin/sh
if [ "$1" = "info" ]; then
  exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "exec" ]; then
  exit 1
fi
exit 0
EOF
chmod +x "$MOCK_BIN/docker"

cat << 'EOF' > "$MOCK_BIN/npx"
#!/bin/sh
exit 0
EOF
chmod +x "$MOCK_BIN/npx"

STDOUT_FILE="$TEST_DIR/out_docker_timeout_stdout"
STDERR_FILE="$TEST_DIR/out_docker_timeout_stderr"
set +e
PORT="$BUSY_PORT" PATH="$MOCK_BIN:$PATH" RUN_SH_REDIS_ATTEMPTS=2 RUN_SH_REDIS_SLEEP=0.05 RUN_SH_DRY_RUN=0 bash "$ROOT/run.sh" >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 0 ]; then
  fail "Redis Timeout erwartete Exit 0, bekam $EXIT_CODE"
elif ! grep -q "Warnung: Redis hat innerhalb des Timeouts" "$STDERR_FILE"; then
  fail "Warnung auf stderr fehlt bei Redis Timeout (stderr: $(cat "$STDERR_FILE"))"
else
  pass "Redis Timeout -> Warnung auf stderr, Server startet trotzdem"
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
