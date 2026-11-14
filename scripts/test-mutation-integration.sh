#!/bin/sh
set -eu

root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
upload_root=$(mktemp -d "${TMPDIR:-/tmp}/talqo-mutation-XXXXXXXXXX")
export COMPOSE_FILE="$root/compose.yaml"
COMPOSE_PROJECT_NAME=$(printf '%s' "${upload_root##*/}" | tr '[:upper:]' '[:lower:]')
export COMPOSE_PROJECT_NAME COMPOSE_PROFILES=test
child=

cleanup() {
	status=$?
	trap - EXIT
	trap '' HUP INT TERM
	if [ -n "$child" ]; then
		if kill -0 "$child" 2>/dev/null; then
			kill -TERM "$child" || status=1
		fi
		wait "$child" || :
	fi
	docker compose down --volumes || status=1
	rm -rf "$upload_root" || status=1
	exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

run() {
	"$@" &
	child=$!
	result=0
	wait "$child" || result=$?
	child=
	return "$result"
}

run docker compose up --detach --wait --wait-timeout 30 postgres-test
address=$(docker compose port postgres-test 5432)
if [ -z "$address" ]; then
	printf '%s\n' 'Could not determine the test PostgreSQL port' >&2
	exit 1
fi
export DATABASE_URL="postgres://talqo:talqo@$address/talqo_template"
export NODE_ENV=test
export APP_SECRET=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE
run docker compose exec -T postgres-test psql -U talqo -d postgres -v ON_ERROR_STOP=1 \
	-c 'CREATE DATABASE talqo_template'
cd "$root/apps/api"
run bun --env-file .env.example src/db/migrate.ts
cd "$root"
export TALQO_TEST_TEMPLATE_URL="$DATABASE_URL"
export TALQO_TEST_UPLOAD_ROOT="$upload_root"
run bun ./node_modules/@stryker-mutator/core/bin/stryker.js run stryker.integration.config.json --ignoreStatic "$@"
