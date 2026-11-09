#!/bin/sh
set -eu

if ! command -v jq >/dev/null 2>&1; then
	printf '%s\n' 'supercov-summary: jq is required to summarize the run' >&2
	exit 1
fi

root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
supercov="$root/scripts/supercov.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

run=$("$supercov" runs latest --json)
tests=$(printf '%s' "$run" | jq -r '.data.tests')
lines=$(printf '%s' "$run" | jq -r '.data.coverage.lines.percentage')
branches=$(printf '%s' "$run" | jq -r '.data.coverage.branches.percentage')

minimum=
if minimized=$("$supercov" runs latest minimize --kind unit --json 2>"$tmp/err"); then
	selected=$(printf '%s' "$minimized" | jq -r '.data.selected | length')
	minimum="  minimum ${selected}/${tests} tests"
elif printf '%s' "$minimized" | jq -e '.error.code == "MINIMIZATION_COMPLEXITY_LIMIT"' >/dev/null 2>&1; then
	minimum="  minimum unavailable (search budget)"
else
	cat "$tmp/err" >&2
	printf '%s\n' "$minimized" >&2
	exit 1
fi

printf 'lines %s%%  branches %s%%  tests %s%s\n' "$lines" "$branches" "$tests" "$minimum"
