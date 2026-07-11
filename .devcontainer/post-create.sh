#!/bin/sh
set -eu

if [ -f package.json ]; then
	pnpm install --frozen-lockfile
fi
