#!/bin/sh
set -eu

unset CDPATH
root="$(cd "$(dirname "$0")/.." && pwd)"
# Remove when https://github.com/supercorp-ai/supercov/issues/209 is fixed.
# Bun drops `--` from process.argv, so bypass the JS wrapper and run the native binary.
native="$(bun -e "import('${root}/node_modules/supercov/bin/native.js').then((m) => console.log(m.resolveNativeBinary()))")"

exec "$native" "$@"
