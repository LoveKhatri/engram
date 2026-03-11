# Engram shell hook — added by `engram init`
export ENGRAM_SESSION_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 8)

__engram_hook() {
  local exit_code=$?
  local cmd
  cmd=$(HISTTIMEFORMAT= history 1 | sed 's/^[ ]*[0-9]*[ ]*//')
  echo "{\"type\":\"command\",\"content\":$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"source\":\"$PWD\",\"exitCode\":$exit_code,\"sessionId\":\"$ENGRAM_SESSION_ID\",\"createdAt\":$(date +%s)}" \
    | nc -q 0 127.0.0.1 7842 2>/dev/null &
}

PROMPT_COMMAND="__engram_hook${PROMPT_COMMAND:+;$PROMPT_COMMAND}"