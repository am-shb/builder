#!/bin/sh
# Runs setup.surql on a SurrealDB server over HTTP, as a root user: the one-shot `surrealdb-setup` service in
# docker-compose.yml, and CI. SurrealDB Cloud is set up with make-user.ts instead (docs/runbooks/README.md).
#
# Settings, all required, read from the environment:
#   SURREAL_HTTP                          the server's HTTP address, e.g. http://localhost:8000
#   SURREAL_ROOT_USER, SURREAL_ROOT_PASS  a root user
#   ENGINE_DB_PASS, API_DB_PASS           passwords for the users engine and api: 32 or more letters, digits, - or _
#
# The app passwords stay in the environment: awk reads them from ENVIRON, so they never appear in a command line.
# curl gets the root user with -u, which it blanks from its own command line. Nothing printed holds a password:
# they are masked in anything the server sends back.
set -eu

for name in SURREAL_HTTP SURREAL_ROOT_USER SURREAL_ROOT_PASS ENGINE_DB_PASS API_DB_PASS; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then echo "setup: $name is not set" >&2; exit 2; fi
done
# The passwords go inside quotes in the script, so only these characters are allowed. printf is a shell builtin.
for name in ENGINE_DB_PASS API_DB_PASS; do
  eval "value=\$$name"
  if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_-]{32,}$'; then
    echo "setup: $name must be 32 or more letters, digits, - or _" >&2; exit 2
  fi
done
export ENGINE_DB_PASS API_DB_PASS

# Replaces every occurrence of `from` with `to`, as plain text (no regex, no special characters).
AWK_REPLACE='function rep(s, from, to,   out, i) {
  out = ""
  while ((i = index(s, from)) > 0) { out = out substr(s, 1, i - 1) to; s = substr(s, i + length(from)) }
  return out s
}'
fill() { awk "$AWK_REPLACE"'{ print rep(rep($0, "{{engine_pass}}", ENVIRON["ENGINE_DB_PASS"]), "{{api_pass}}", ENVIRON["API_DB_PASS"]) }'; }
mask() { awk "$AWK_REPLACE"'{ print rep(rep($0, ENVIRON["ENGINE_DB_PASS"], "***"), ENVIRON["API_DB_PASS"], "***") }'; }

script="$(dirname "$0")/setup.surql"
filled=$(fill < "$script")
# Every occurrence must be filled, the guards' and the users' alike.
if printf '%s' "$filled" | grep -q '{{'; then echo "setup: a placeholder is left in $script" >&2; exit 1; fi

status=0
reply=$(printf '%s\n' "$filled" |
  curl -sS --fail-with-body --retry 5 --retry-connrefused --retry-delay 1 \
    -u "$SURREAL_ROOT_USER:$SURREAL_ROOT_PASS" -H "Accept: application/json" \
    --data-binary @- "${SURREAL_HTTP%/}/sql") || status=$?

# The server answers with one result per statement. Every one must be OK.
ok=$(printf '%s' "$reply" | grep -o '"status":"OK"' | wc -l | tr -d ' ')
failed=$(printf '%s' "$reply" | grep -o '"status":"ERR"' | wc -l | tr -d ' ')
if [ "$status" -ne 0 ] || [ "$failed" -ne 0 ] || [ "$ok" -eq 0 ]; then
  echo "setup: failed (curl exit $status, $failed statements failed). The server said:" >&2
  printf '%s\n' "$reply" | mask >&2
  exit 1
fi
echo "setup: done, $ok statements OK (namespace builder, databases engine and api, users engine and api)"
