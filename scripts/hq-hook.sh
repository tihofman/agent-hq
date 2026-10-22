#!/usr/bin/env bash
# Claude-Code-Hook for GitHub PR events
# Listens to PostToolUse events for Bash commands, extracts PR lifecycle actions,
# and sends corresponding events to Agent-HQ.
# Always exits 0 to never block Claude Code.

set -uo pipefail

# Ensure exit code is always 0
trap 'exit 0' EXIT

# Read JSON payload from stdin
INPUT="$(cat 2>/dev/null || true)"
[ -z "$INPUT" ] && exit 0

# Check jq availability and validate JSON input
command -v jq >/dev/null 2>&1 || exit 0
jq -e . >/dev/null 2>&1 <<<"$INPUT" || exit 0

# Check tool name (if provided, must be Bash)
TOOL_NAME="$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || true)"
if [ -n "$TOOL_NAME" ] && [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

# Extract tool fields
COMMAND="$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || true)"
[ -z "$COMMAND" ] && exit 0

CWD="$(jq -r '.cwd // empty' <<<"$INPUT" 2>/dev/null || true)"
[ -z "$CWD" ] && CWD="$PWD"

# Note on Claude Code PostToolUse format:
# Official docs (https://code.claude.com/docs/en/hooks) state that the Bash tool_response
# contains { stdout, stderr, interrupted, isImage }, but no exit code.
# We extract stdout/stderr text and also check for optional exitCode/exit_code if provided.
RESPONSE_TEXT="$(jq -r '
  if .tool_response | type == "object" then
    ((.tool_response.stdout // "") + "\n" + (.tool_response.stderr // ""))
  elif .tool_response | type == "string" then
    .tool_response
  else
    ""
  end' <<<"$INPUT" 2>/dev/null || true)"

EXIT_CODE="$(jq -r '
  if .tool_response | type == "object" then
    (.tool_response.exitCode // .tool_response.exit_code // empty)
  else
    empty
  end' <<<"$INPUT" 2>/dev/null || true)"

# Determine event type based on command pattern
EVENT=""

# Case-insensitive pattern matching for subcommands and keywords
shopt -s nocasematch

if [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$) ]] && [[ "$COMMAND" =~ (^|[[:space:]])(--draft|-d)([[:space:]]|$) ]]; then
  EVENT="DRAFT_PR_CREATED"
elif [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+(diff|view)([[:space:]]|$) ]]; then
  EVENT="REVIEW_START"
elif [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+ready([[:space:]]|$) ]]; then
  EVENT="PR_READY"
elif [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+checks([[:space:]]|$) ]]; then
  # Determination of CI_CHECK_PASS / CI_CHECK_FAIL:
  # If exitCode is present and non-zero, or output contains fail indicators -> CI_CHECK_FAIL
  # Otherwise if output contains pass indicators or exitCode is 0 -> CI_CHECK_PASS
  if [ -n "$EXIT_CODE" ] && [ "$EXIT_CODE" != "0" ]; then
    EVENT="CI_CHECK_FAIL"
  elif [[ "$RESPONSE_TEXT" =~ (fail|failure|failed|error|✕|✖) ]]; then
    EVENT="CI_CHECK_FAIL"
  elif [[ "$RESPONSE_TEXT" =~ (pass|passed|success|successful|✓|✔) ]]; then
    EVENT="CI_CHECK_PASS"
  elif [ -n "$EXIT_CODE" ] && [ "$EXIT_CODE" = "0" ]; then
    EVENT="CI_CHECK_PASS"
  else
    # Default to PASS if no failure was detected
    EVENT="CI_CHECK_PASS"
  fi
elif [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$) ]]; then
  EVENT="MERGED"
else
  # Non-matching command: send nothing
  exit 0
fi

# Extract PR number where possible
PR_NUMBER=""

# 1. Check for PR URL in tool response or command (e.g. .../pull/123)
if [[ "$RESPONSE_TEXT" =~ /pull/([0-9]+)([^0-9]|$) ]]; then
  PR_NUMBER="${BASH_REMATCH[1]}"
elif [[ "$COMMAND" =~ /pull/([0-9]+)([^0-9]|$) ]]; then
  PR_NUMBER="${BASH_REMATCH[1]}"
fi

# 2. Check for explicit number argument in command (e.g. gh pr view 42, gh pr ready #42)
if [ -z "$PR_NUMBER" ]; then
  if [[ "$COMMAND" =~ gh[[:space:]]+pr[[:space:]]+(diff|view|ready|checks|merge)[[:space:]]+#?([0-9]+)([^0-9]|$) ]]; then
    PR_NUMBER="${BASH_REMATCH[2]}"
  elif [[ "$COMMAND" =~ gh[[:space:]]+pr[[:space:]]+(diff|view|ready|checks|merge)[[:space:]]+.*[[:space:]]+#?([0-9]+)([^0-9]|$) ]]; then
    PR_NUMBER="${BASH_REMATCH[2]}"
  fi
fi

# 3. Check for issue/PR number in tool response if not yet matched (e.g. #42)
if [ -z "$PR_NUMBER" ]; then
  if [[ "$RESPONSE_TEXT" =~ [[:space:]]#([0-9]+)([^0-9]|$) ]]; then
    PR_NUMBER="${BASH_REMATCH[1]}"
  fi
fi

# Validate PR_NUMBER is a positive integer
if [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  DATA_JSON="$(jq -nc --argjson pr "$PR_NUMBER" '{prNumber: $pr}')"
else
  DATA_JSON="{}"
fi

# Build payload
PAYLOAD="$(jq -nc \
  --arg e "$EVENT" \
  --arg a "claude" \
  --arg cwd "$CWD" \
  --argjson data "$DATA_JSON" \
  '{event: $e, agent: $a, cwd: $cwd, data: $data}')"

# Send event with delegate.sh timeout settings (0.1s connect, 0.5s max-time)
HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"
curl --connect-timeout 0.1 --max-time 0.5 -s -X POST "$HQ/api/events" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  >/dev/null 2>&1 || true

exit 0
