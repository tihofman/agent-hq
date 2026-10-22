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
# Test 1: Fehlendes Tool (jq) führt zu Exit 1 mit verständlicher Meldung
# -----------------------------------------------------------------------------
MOCK_BIN_NO_JQ="$TEST_DIR/bin_no_jq"
mkdir -p "$MOCK_BIN_NO_JQ"
for cmd in bash sh node npm gh lsof dirname basename; do
  p="$(command -v "$cmd" 2>/dev/null || true)"
  [ -z "$p" ] || ln -sf "$p" "$MOCK_BIN_NO_JQ/$cmd"
done

OUT_FILE="$TEST_DIR/out_no_jq"
set +e
PATH="$MOCK_BIN_NO_JQ" RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh" >"$OUT_FILE" 2>&1
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 1 ]; then
  fail "Fehlendes Tool (jq) erwartete Exit 1, bekam $EXIT_CODE"
elif ! grep -q "jq" "$OUT_FILE"; then
  fail "Fehlermeldung nennt das fehlende Tool jq nicht (Ausgabe: $(cat "$OUT_FILE"))"
else
  pass "Fehlendes Tool jq -> Exit 1 mit klarer Meldung"
fi

# -----------------------------------------------------------------------------
# Test 2: Fehlendes Tool (gh) führt zu Exit 1 mit verständlicher Meldung
# -----------------------------------------------------------------------------
MOCK_BIN_NO_GH="$TEST_DIR/bin_no_gh"
mkdir -p "$MOCK_BIN_NO_GH"
for cmd in bash sh node npm jq lsof dirname basename; do
  p="$(command -v "$cmd" 2>/dev/null || true)"
  [ -z "$p" ] || ln -sf "$p" "$MOCK_BIN_NO_GH/$cmd"
done

OUT_FILE="$TEST_DIR/out_no_gh"
set +e
PATH="$MOCK_BIN_NO_GH" RUN_SH_DRY_RUN=1 bash "$ROOT/run.sh" >"$OUT_FILE" 2>&1
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 1 ]; then
  fail "Fehlendes Tool (gh) erwartete Exit 1, bekam $EXIT_CODE"
elif ! grep -q "gh" "$OUT_FILE"; then
  fail "Fehlermeldung nennt das fehlende Tool gh nicht (Ausgabe: $(cat "$OUT_FILE"))"
else
  pass "Fehlendes Tool gh -> Exit 1 mit klarer Meldung"
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

  kill "$LISTENER_PID" 2>/dev/null || true
  wait "$LISTENER_PID" 2>/dev/null || true
  LISTENER_PID=

  if [ "$EXIT_CODE" -ne 1 ]; then
    fail "Belegter Port erwartete Exit 1, bekam $EXIT_CODE (Ausgabe: $(cat "$OUT_FILE"))"
  elif ! grep -q "$BUSY_PORT" "$OUT_FILE"; then
    fail "Fehlermeldung nennt den belegten Port nicht (Ausgabe: $(cat "$OUT_FILE"))"
  elif ! grep -q -i "belegt" "$OUT_FILE"; then
    fail "Fehlermeldung erwähnt 'belegt' nicht (Ausgabe: $(cat "$OUT_FILE"))"
  elif ! grep -q "node" "$OUT_FILE"; then
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
# Zusammenfassung
# -----------------------------------------------------------------------------
echo "---"
echo "Tests completed: $TOTAL | Failed: $FAILED"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
