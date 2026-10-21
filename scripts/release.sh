#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

if [[ ${1:-} == current-main && $# == 1 ]]; then
	current_main
elif [[ ${1:-} == validate && $# == 2 ]]; then
	validate_release "$2"
	output version "$2"
elif [[ $# == 1 ]]; then
	version=$1
	require_version "$version"
	git fetch --quiet origin main --tags
	[[ -z $(git status --porcelain) ]] || fail 'Release requires a clean checkout'
	current_main
	if git show-ref --verify --quiet "refs/tags/v$version"; then
		fail 'Release tag already exists'
	fi
	check_version_order "$version"
	git tag -a "v$version" -m "Release $version"
	git push origin "refs/tags/v$version"
else
	fail 'Usage: bun run release X.Y.Z'
fi
