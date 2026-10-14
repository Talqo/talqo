#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
REPOSITORY=${GITHUB_REPOSITORY:-}
if [[ -z $REPOSITORY ]]; then
	origin=$(git remote get-url origin)
	case "$origin" in
		git@github.com:*) REPOSITORY=${origin#git@github.com:} ;;
		https://github.com/*) REPOSITORY=${origin#https://github.com/} ;;
		ssh://git@github.com/*) REPOSITORY=${origin#ssh://git@github.com/} ;;
		*) printf 'Expected a GitHub origin remote\n' >&2; exit 1 ;;
	esac
	REPOSITORY=${REPOSITORY%.git}
fi
REGISTRY_OWNER=${REPOSITORY%%/*}
REGISTRY_OWNER=${REGISTRY_OWNER,,}
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
	local tag candidate newest tags

	if [[ $# == 1 ]]; then
		tags=$(git tag --list 'v*')
	else
		tags=$2
	fi

	while IFS= read -r tag; do
		candidate=${tag#v}
		if [[ $candidate =~ $VERSION_PATTERN && $candidate != "$1" ]]; then
			newest=$(printf '%s\n%s\n' "$candidate" "$1" | sort -V | tail -n 1)
			if [[ $newest != "$1" ]]; then
				fail "A newer release tag already exists: $tag"
			fi
		fi
	done <<< "$tags"
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
	local published_tags
	published_tags=$(gh api --paginate "repos/$REPOSITORY/releases?per_page=100" \
		--jq '.[] | select(.draft == false and .prerelease == false) | .tag_name')
	check_version_order "$1" "$published_tags"
}
