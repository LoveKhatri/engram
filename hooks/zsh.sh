# Engram shell hook — added by `engram init`
export ENGRAM_SESSION_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 8 2>/dev/null)

__engram_hook() {
  local exit_code=$?
  local cmd=$history[$HISTCMD]
  echo "{\"type\":\"command\",\"content\":$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"source\":\"$PWD\",\"exitCode\":$exit_code,\"sessionId\":\"$ENGRAM_SESSION_ID\",\"createdAt\":$(date +%s)}" \
    | nc -q 0 127.0.0.1 7842 2>/dev/null &
}

precmd_functions+=(__engram_hook)