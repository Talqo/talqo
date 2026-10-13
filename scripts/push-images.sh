#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

[[ $# -le 2 ]] || fail 'Usage: push-images.sh all|talqo|docs|promote [VERSION]'
target=${1:-all}
version=${2:-dev}
case "$target" in
	all|talqo|docs|promote)
		;;
	*)
		fail 'Unknown image target'
		;;
esac

if [[ $version != dev ]]; then
	validate_release "$version"
	[[ -z $(git status --porcelain) ]] || fail 'Stable publication requires a clean checkout'
elif [[ $target == promote ]]; then
	fail 'Cannot promote development images'
elif [[ ${GITHUB_ACTIONS:-} == true ]]; then
	current_main
fi
revision=$(git rev-parse HEAD)
components=(talqo docs)
if [[ $target == talqo || $target == docs ]]; then
	components=("$target")
fi

for component in "${components[@]}"; do
	case "$component" in
		talqo)
			repository=ghcr.io/talqo/talqo
			dockerfile=Dockerfile
			;;
		docs)
			repository=ghcr.io/talqo/talqo-docs
			dockerfile=apps/docs/Dockerfile
			;;
	esac

	reference=$repository:$version
	manifest=
	if [[ $version != dev ]]; then
		if manifest=$(inspect_manifest "$reference"); then
			check_image_identity "$reference" "$version"
		else
			status=$?
			[[ $status == 1 && $target != promote ]] || exit "$status"
		fi
	fi
	if [[ $target == promote ]]; then
		digest=$(jq -er '.digest' <<< "$manifest")
		docker buildx imagetools create --prefer-index=false --tag "$repository:latest" "$repository@$digest"
	else
		if [[ -z $manifest ]]; then
			docker buildx build --platform linux/amd64 --push --file "$dockerfile" --tag "$reference" \
				--label "org.opencontainers.image.source=$SOURCE" \
				--label "org.opencontainers.image.revision=$revision" \
				--label "org.opencontainers.image.version=$version" .
			manifest=$(inspect_manifest "$reference")
		fi
		digest=$(jq -er '.digest' <<< "$manifest")
		output "$component-digest" "$digest"
	fi
done
