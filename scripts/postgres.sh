#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
R2_PG_BIN="${R2_PG_BIN:-/usr/lib/postgresql/17/bin}"
R2_DATA="$PWD/.local/postgres"
R2_SOCKET="$PWD/.local/pgsocket"
mkdir -p "$R2_SOCKET"
chmod 700 "$R2_SOCKET"
case "${1:-start}" in
 start)
  if [ ! -f "$R2_DATA/PG_VERSION" ]; then
   "$R2_PG_BIN/initdb" -D "$R2_DATA" --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 > .local/initdb.log
  fi
  if ! "$R2_PG_BIN/pg_ctl" -D "$R2_DATA" status >/dev/null 2>&1; then
   "$R2_PG_BIN/pg_ctl" -D "$R2_DATA" -l "$PWD/.local/postgres.log" -o "-k $R2_SOCKET -p 55439 -c listen_addresses='' -c unix_socket_permissions=0700" start
  fi
  ;;
 stop) "$R2_PG_BIN/pg_ctl" -D "$R2_DATA" stop -m fast ;;
 *) exit 2 ;;
esac
