FROM oven/bun:1.3.14 AS bun
FROM rhysd/actionlint:1.7.12 AS actionlint
FROM ghcr.io/zizmorcore/zizmor:1.27.0 AS zizmor

FROM mcr.microsoft.com/devcontainers/base:ubuntu26.04

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=actionlint /usr/local/bin/actionlint /usr/local/bin/shellcheck /usr/local/bin/
COPY --from=zizmor /usr/bin/zizmor /usr/local/bin/zizmor

RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx \
	&& ln -sf /usr/local/bin/bun /usr/local/bin/npm \
	&& ln -sf /usr/local/bin/bun /usr/local/bin/node \
	&& printf '#!/bin/sh\nexec bunx "$@"\n' > /usr/local/bin/npx \
	&& chmod +x /usr/local/bin/npx
