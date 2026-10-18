#!/bin/sh
# Runs setup.surql on a SurrealDB server over HTTP, as a root user: the one-shot `surrealdb-setup` service in
# docker-compose.yml, and CI. SurrealDB Cloud is set up from Surrealist instead (docs/runbooks/README.md).
#
# Settings, all required:
#   SURREAL_HTTP                          the server's HTTP address, e.g. http://localhost:8000
#   SURREAL_ROOT_USER, SURREAL_ROOT_PASS  a root user
#   ENGINE_DB_PASS, API_DB_PASS           passwords for the users engine and api: 32 or more letters, digits, - or _
#
# It never prints a password: they are masked in anything the server sends back.
set -eu

for name in SURREAL_HTTP SURREAL_ROOT_USER SURREAL_ROOT_PASS ENGINE_DB_PASS API_DB_PASS; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then echo "setup: $name is not set" >&2; exit 2; fi
done
# The passwords go inside quotes in the script, and into sed below, so only these characters are allowed.
for name in ENGINE_DB_PASS API_DB_PASS; do
  eval "value=\$$name"
  if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_-]{32,}$'; then
    echo "setup: $name must be 32 or more letters, digits, - or _" >&2; exit 2
  fi
done

mask() { sed -e "s/$ENGINE_DB_PASS/***/g" -e "s/$API_DB_PASS/***/g"; }

script="$(dirname "$0")/setup.surql"
status=0
reply=$(sed -e "s/{{engine_pass}}/$ENGINE_DB_PASS/g" -e "s/{{api_pass}}/$API_DB_PASS/g" "$script" |
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
