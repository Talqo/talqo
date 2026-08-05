#!/bin/sh
set -eu

if [ -f package.json ]; then
	bun ci
fi
