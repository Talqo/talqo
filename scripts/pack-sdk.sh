#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

[[ $# -le 1 ]] || fail 'Usage: bun run pack:sdk [X.Y.Z]'
version=${1:-$(jq -r '.version' packages/sdk/package.json)}
require_version "$version"
staging=$ROOT/dist/sdk-package
archive=$ROOT/dist/talqo-sdk-$version.tgz

rm -rf "$ROOT/packages/sdk/dist" "$staging"
bun run --cwd packages/sdk build

mkdir -p "$staging"
cp -R packages/sdk/dist "$staging/dist"
cp LICENSE.md "$staging/"
jq --arg version "$version" --arg revision "$(git rev-parse HEAD)" '
	.version = $version |
	.gitHead = $revision |
	.exports = {".": {types: .types, import: "./dist/index.js"}} |
	del(.private, .scripts, .devDependencies)
' packages/sdk/package.json > "$staging/package.json"
(
	cd "$staging"
	bun pm pack --filename "$archive" --ignore-scripts --quiet
)
output tarball "dist/talqo-sdk-$version.tgz"
