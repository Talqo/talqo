#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

[[ $# == 2 ]] || fail 'Usage: deploy.sh dev|prod VERSION'
environment=$1
version=$2
case "$environment" in
	dev)
		if [[ $version != dev ]]; then
			fail 'Dev requires the dev image tag'
		fi
		;;
	prod)
		require_version "$version"
		;;
	*)
		fail 'Unknown deployment environment'
		;;
esac

host=${DEPLOY_HOST:?Missing DEPLOY_HOST}
port=${DEPLOY_PORT:?Missing DEPLOY_PORT}
account=${DEPLOY_ACCOUNT:?Missing DEPLOY_ACCOUNT}
[[ -n ${DEPLOY_SSH_KEY:-} && -n ${DEPLOY_HOST_KEY:-} ]] || fail 'Missing SSH keys'
[[ $DEPLOY_HOST_KEY != *$'\n'* && $DEPLOY_HOST_KEY != *$'\r'* ]] || fail 'Host key must be one line'
talqo=${TALQO_DIGEST:?Missing TALQO_DIGEST}
[[ $talqo =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Invalid Talqo image digest'
command="deploy $version $talqo"

if [[ $environment == prod ]]; then
	docs=${DOCS_DIGEST:?Missing DOCS_DIGEST}
	[[ $docs =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Invalid docs image digest'
	validate_release "$version"
	command+=" $docs"
fi

umask 077
directory=$(mktemp -d)
trap 'rm -rf "$directory"' EXIT

printf '%s\n' "$DEPLOY_SSH_KEY" > "$directory/key"
known_host=$host
if [[ $port != 22 ]]; then
	known_host="[$host]:$port"
fi
printf '%s %s\n' "$known_host" "$DEPLOY_HOST_KEY" > "$directory/known_hosts"
ssh-keygen -l -f "$directory/known_hosts" > /dev/null

timeout --kill-after=30s 15m ssh -F /dev/null -T -a -x -p "$port" -i "$directory/key" \
	-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
	-o "UserKnownHostsFile=$directory/known_hosts" -o GlobalKnownHostsFile=/dev/null \
	-o ClearAllForwardings=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
	-- "$account@$host" "$command"
