FROM node:26.5.0-bookworm-slim AS node

FROM mcr.microsoft.com/devcontainers/base:ubuntu26.04

COPY --from=node /usr/local/ /usr/local/

RUN npm install --global --ignore-scripts pnpm@11.11.0 \
	&& npm cache clean --force
