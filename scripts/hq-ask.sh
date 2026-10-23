#!/usr/bin/env bash
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "Fehler: jq ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Fehler: curl ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi

if [ -z "${HQ_ISSUE_ID:-}" ] || [ -z "${HQ_TEAM:-}" ]; then
  echo "Fehler: HQ_ISSUE_ID und HQ_TEAM müssen gesetzt sein (aktuell: HQ_ISSUE_ID='${HQ_ISSUE_ID:-}', HQ_TEAM='${HQ_TEAM:-}')." >&2
  exit 1
fi

QUESTION=""
OPTIONS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --option)
      if [ "$#" -lt 2 ]; then
        echo "Fehler: --option erfordert einen Wert." >&2
        exit 1
      fi
      OPTIONS+=("$2")
      shift 2
      ;;
    --option=*)
      OPTIONS+=("${1#*=}")
      shift
      ;;
    -o)
      if [ "$#" -lt 2 ]; then
        echo "Fehler: -o erfordert einen Wert." >&2
        exit 1
      fi
      OPTIONS+=("$2")
      shift 2
      ;;
    -h|--help)
      echo "Verwendung: $0 '<Frage>' [--option '<A>' ...]"
      exit 0
      ;;
    *)
      if [ -z "$QUESTION" ]; then
        QUESTION="$1"
        shift
      else
        echo "Fehler: Unerwartetes Argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [ -z "$QUESTION" ]; then
  echo "Fehler: Keine Frage angegeben. Verwendung: $0 '<Frage>' [--option '<A>' ...]" >&2
  exit 1
fi

if [ "${#OPTIONS[@]}" -gt 0 ]; then
  PAYLOAD="$(jq -nc \
    --arg issueId "$HQ_ISSUE_ID" \
    --arg team "$HQ_TEAM" \
    --arg question "$QUESTION" \
    '--args' \
    '{
      issueId: ($issueId | if test("^[0-9]+$") then tonumber else . end),
      team: $team,
      question: $question,
      options: $ARGS.positional
    }' -- "${OPTIONS[@]}")"
else
  PAYLOAD="$(jq -nc \
    --arg issueId "$HQ_ISSUE_ID" \
    --arg team "$HQ_TEAM" \
    --arg question "$QUESTION" \
    '{
      issueId: ($issueId | if test("^[0-9]+$") then tonumber else . end),
      team: $team,
      question: $question
    }')"
fi

if [ -z "$PAYLOAD" ]; then
  echo "Fehler: Konnte JSON-Payload nicht erstellen." >&2
  exit 1
fi

HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"
HQ="${HQ%/}"

RESPONSE="$(curl --connect-timeout "${HQ_CONNECT_TIMEOUT:-0.1}" \
  --max-time "${HQ_MAX_TIME:-0.5}" \
  -s \
  -w "\n%{http_code}" \
  -X POST "$HQ/api/questions" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>&1)"
CURL_EXIT=$?

if [ "$CURL_EXIT" -ne 0 ]; then
  echo "Fehler: Verbindung zu Agent-HQ unter $HQ fehlgeschlagen (Curl-Code $CURL_EXIT)." >&2
  exit 1
fi

HTTP_CODE="$(tail -n1 <<<"$RESPONSE")"
BODY="$(sed '$d' <<<"$RESPONSE")"

if [ "$HTTP_CODE" = "000" ]; then
  echo "Fehler: Verbindung zu Agent-HQ unter $HQ fehlgeschlagen." >&2
  exit 1
fi

if [[ "$HTTP_CODE" =~ ^2[0-9]{2}$ ]]; then
  echo "Rückfrage gestellt. Beende dich jetzt ohne weitere Änderungen."
  exit 0
else
  if [ -n "$BODY" ]; then
    echo "Fehler: Agent-HQ meldet HTTP $HTTP_CODE: $BODY" >&2
  else
    echo "Fehler: Agent-HQ meldet HTTP $HTTP_CODE." >&2
  fi
  exit 1
fi
