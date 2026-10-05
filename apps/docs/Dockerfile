# Required runtime env: none. TALQO_DOCS_PORT defaults to 3002.
# Build from the repository root: docker build -f apps/docs/Dockerfile .

FROM oven/bun:1.4.2 AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,target=/root/.bun/install/cache \
	bun install --frozen-lockfile && \
	bunx turbo run build --filter=@talqo/docs

FROM oven/bun:1.4.2-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
	TALQO_DOCS_PORT=3002

# The SSR bundle is built with noExternal, so `dist` is the only thing it needs at runtime.
COPY --from=build /app/apps/docs/dist ./apps/docs/dist
COPY --from=build /app/apps/docs/src/serve.ts ./apps/docs/src/serve.ts

USER bun

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.TALQO_DOCS_PORT || '3002') + '/docs').then((r) => { if (!r.ok) process.exit(1) })"]

CMD ["bun", "apps/docs/src/serve.ts"]
