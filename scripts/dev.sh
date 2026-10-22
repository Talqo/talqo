#!/bin/sh
set -eu

root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
cd "$root"

command -v docker >/dev/null || {
	printf '%s\n' 'Docker is required to run the development stack.' >&2
	exit 1
}

: "${TALQO_POSTGRES_PORT:=0}"
: "${TALQO_DOCLING_PORT:=0}"
export TALQO_POSTGRES_PORT TALQO_DOCLING_PORT

# The kernel picks an unused port; scanning with ss/lsof would race the later bind.
free_port() {
	bun -e 'const server = Bun.serve({ fetch: () => new Response(), port: 0 }); console.log(server.port); server.stop(true)'
}

dev_server=

# shellcheck disable=SC2329
# Invoked by the EXIT, HUP, INT, and TERM traps.
cleanup() {
	status=$?
	trap - EXIT HUP INT TERM
	if [ -n "$dev_server" ] && kill -0 "$dev_server" 2>/dev/null; then
		kill -TERM "$dev_server"
		wait "$dev_server" || :
	fi
	docker compose down || status=1
	exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose up --detach --wait --wait-timeout 60 postgres docling

postgres_port=$(docker compose port postgres 5432 | sed 's/.*://')
docling_port=$(docker compose port docling 5001 | sed 's/.*://')
if [ -z "$postgres_port" ] || [ -z "$docling_port" ]; then
	printf '%s\n' 'Could not determine the development container ports.' >&2
	exit 1
fi

export DATABASE_URL="postgres://talqo:talqo@127.0.0.1:$postgres_port/talqo"
export TALQO_DOCLING_URL="http://127.0.0.1:$docling_port"
: "${TALQO_API_PORT:=$(free_port)}"
: "${TALQO_WEB_PORT:=$(free_port)}"
: "${TALQO_WIDGET_PORT:=$(free_port)}"
export TALQO_API_PORT TALQO_WEB_PORT TALQO_WIDGET_PORT

printf 'Dashboard: http://localhost:%s\nWidget demo: http://localhost:%s\nAPI: http://localhost:%s\n' \
	"$TALQO_WEB_PORT" "$TALQO_WIDGET_PORT" "$TALQO_API_PORT"

# Background commands otherwise receive /dev/null instead of terminal input.
exec 3<&0
turbo run dev --filter=@talqo/web --ui=tui <&3 3<&- &
dev_server=$!
exec 3<&-
status=0
wait "$dev_server" || status=$?
dev_server=
exit "$status"
