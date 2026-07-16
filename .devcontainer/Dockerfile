FROM oven/bun:1.3.14 AS bun

FROM mcr.microsoft.com/devcontainers/base:ubuntu26.04

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx \
	&& ln -sf /usr/local/bin/bun /usr/local/bin/npm \
	&& printf '#!/bin/sh\nexec bunx "$@"\n' > /usr/local/bin/npx \
	&& chmod +x /usr/local/bin/npx
