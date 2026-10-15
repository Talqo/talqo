#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

[[ $# == 1 ]] || fail 'Usage: push-images.sh all|talqo|docs'
case "$1" in
	all) components=(talqo docs) ;;
	talqo|docs) components=("$1") ;;
	*) fail 'Unknown image target' ;;
esac

for component in "${components[@]}"; do
	case "$component" in
		talqo)
			image=ghcr.io/$REGISTRY_OWNER/talqo
			dockerfile=Dockerfile
			;;
		docs)
			image=ghcr.io/$REGISTRY_OWNER/talqo-docs
			dockerfile=apps/docs/Dockerfile
			;;
	esac

	docker buildx build --platform linux/amd64 --push \
		--file "$dockerfile" --tag "$image:dev" \
		--label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
		--label org.opencontainers.image.version=dev .
done
