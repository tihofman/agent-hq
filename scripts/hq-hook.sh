#!/usr/bin/env bash
# Claude-Code-Hook for GitHub PR events
# Listens to PostToolUse and PostToolUseFailure events for Bash commands, extracts PR lifecycle actions,
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

HOOK_EVENT_NAME="$(jq -r '.hook_event_name // "PostToolUse"' <<<"$INPUT" 2>/dev/null || true)"
if [ "$HOOK_EVENT_NAME" != "PostToolUse" ] && [ "$HOOK_EVENT_NAME" != "PostToolUseFailure" ]; then
  exit 0
fi

# Note on Claude Code hook formats (https://code.claude.com/docs/en/hooks):
# PostToolUse: successful tool execution; tool_response contains { stdout, stderr, interrupted, isImage }, but no exit code.
# PostToolUseFailure: failed tool execution (exit != 0); error field contains "Exit code N\n<output>".
RESPONSE_TEXT="$(jq -r '
  if .tool_response | type == "object" then
    ((.tool_response.stdout // "") + "\n" + (.tool_response.stderr // ""))
  elif .tool_response | type == "string" then
    .tool_response
  elif .error | type == "string" then
    .error
  else
    ""
  end' <<<"$INPUT" 2>/dev/null || true)"

# Determine event type based on hook event and command pattern
EVENT=""

# Case-insensitive pattern matching for subcommands
shopt -s nocasematch

if [ "$HOOK_EVENT_NAME" = "PostToolUseFailure" ]; then
  # Only gh pr checks failure is reported; all other failed commands must send nothing
  if [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+checks([[:space:]]|$) ]]; then
    ERROR_MSG="$(jq -r '.error // empty' <<<"$INPUT" 2>/dev/null || true)"
    FAIL_CODE=""
    if [[ "$ERROR_MSG" =~ Exit[[:space:]]+code[[:space:]]+([0-9]+) ]]; then
      FAIL_CODE="${BASH_REMATCH[1]}"
    fi
    if [ "$FAIL_CODE" = "1" ]; then
      EVENT="CI_CHECK_FAIL"
    else
      # Exit code 8 (pending) or other non-1 error: send nothing
      exit 0
    fi
  else
    exit 0
  fi
else
  # PostToolUse: tool completed successfully (exit code 0)
  if [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$) ]] && [[ "$COMMAND" =~ (^|[[:space:]])(--draft|-d)([[:space:]]|$) ]]; then
    EVENT="DRAFT_PR_CREATED"
  elif [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+(diff|view)([[:space:]]|$) ]]; then
    EVENT="REVIEW_START"
  elif [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+ready([[:space:]]|$) ]]; then
    EVENT="PR_READY"
  elif [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+checks([[:space:]]|$) ]]; then
    EVENT="CI_CHECK_PASS"
  elif [[ "$COMMAND" =~ (^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$) ]]; then
    EVENT="MERGED"
  else
    # Non-matching command: send nothing
    exit 0
  fi
fi

# Extract PR number:
# 1. First from command (pull URL or explicit argument)
# 2. Then /pull/N URL in output
# 3. Fallback to gh pr merge output format ("pull request .*#N")
PR_NUMBER=""

if [[ "$COMMAND" =~ /pull/([0-9]+)([^0-9]|$) ]]; then
  PR_NUMBER="${BASH_REMATCH[1]}"
elif [[ "$COMMAND" =~ gh[[:space:]]+pr[[:space:]]+(diff|view|ready|checks|merge)[[:space:]]+#?([0-9]+)([^0-9]|$) ]]; then
  PR_NUMBER="${BASH_REMATCH[2]}"
elif [[ "$COMMAND" =~ gh[[:space:]]+pr[[:space:]]+(diff|view|ready|checks|merge)[[:space:]]+.*[[:space:]]+#?([0-9]+)([^0-9]|$) ]]; then
  PR_NUMBER="${BASH_REMATCH[2]}"
fi

if [ -z "$PR_NUMBER" ]; then
  if [[ "$RESPONSE_TEXT" =~ /pull/([0-9]+)([^0-9]|$) ]]; then
    PR_NUMBER="${BASH_REMATCH[1]}"
  fi
fi

if [ -z "$PR_NUMBER" ]; then
  if [[ "$RESPONSE_TEXT" =~ pull[[:space:]]+request[[:space:]].*#([0-9]+)([^0-9]|$) ]]; then
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
