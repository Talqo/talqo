#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
SOURCE=https://github.com/Talqo/talqo
VERSION_PATTERN='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

fail() {
	printf '%s\n' "$*" >&2
	exit 1
}

require_version() {
	if [[ ! $1 =~ $VERSION_PATTERN ]]; then
		fail 'Expected a stable version X.Y.Z'
	fi
}

output() {
	printf '%s=%s\n' "$1" "$2"
	if [[ -n ${GITHUB_OUTPUT:-} ]]; then
		printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
	fi
}

current_main() {
	git fetch --quiet origin main
	if [[ $(git rev-parse HEAD) != "$(git rev-parse origin/main)" ]]; then
		fail 'Checkout is not current origin/main'
	fi
}

check_version_order() {
	local tag candidate newest

	while IFS= read -r tag; do
		candidate=${tag#v}
		if [[ $candidate =~ $VERSION_PATTERN && $candidate != "$1" ]]; then
			newest=$(printf '%s\n%s\n' "$candidate" "$1" | sort -V | tail -n 1)
			if [[ $newest != "$1" ]]; then
				fail "A newer release tag already exists: $tag"
			fi
		fi
	done < <(git tag --list 'v*')
}

validate_release() {
	require_version "$1"
	git fetch --quiet origin main --tags

	if [[ $(git cat-file -t "refs/tags/v$1") != tag ]]; then
		fail 'Release requires an annotated tag'
	fi
	if [[ $(git rev-parse "refs/tags/v$1^{}") != "$(git rev-parse HEAD)" ]]; then
		fail 'Checkout does not match release tag'
	fi

	git merge-base --is-ancestor HEAD origin/main
	check_version_order "$1"
}

inspect_manifest() {
	local result

	if result=$(docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' 2>&1); then
		printf '%s\n' "$result"
	elif [[ $result == *"$1: not found"* || $result == *"$1"*'manifest unknown'* ]]; then
		return 1
	else
		printf '%s\n' "$result" >&2
		return 2
	fi
}

check_image_identity() {
	docker buildx imagetools inspect "$1" --format '{{json .Image}}' |
		jq -e --arg source "$SOURCE" --arg revision "$(git rev-parse HEAD)" --arg version "$2" '
			(."linux/amd64" // .).config.Labels |
			.["org.opencontainers.image.source"] == $source and
			.["org.opencontainers.image.revision"] == $revision and
			.["org.opencontainers.image.version"] == $version
		' > /dev/null || fail "Conflicting release image: $1"
}
