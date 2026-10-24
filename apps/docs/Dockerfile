FROM oven/bun:1.4.4 AS pruner

WORKDIR /app

COPY package.json ./
RUN bun install --global "turbo@$(bun -p 'require("./package.json").devDependencies.turbo')"

COPY . .
RUN turbo prune @talqo/docs --docker

FROM oven/bun:1.4.4 AS build

WORKDIR /app

COPY --from=pruner /app/out/json/ ./
COPY bunfig.toml ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
	BUN_INSTALL_GLOBAL_STORE=0 bun install --frozen-lockfile

COPY --from=pruner /app/out/full/ ./

RUN bunx turbo run build --filter=@talqo/docs

FROM oven/bun:1.4.4-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/Talqo/talqo"

WORKDIR /app

ENV NODE_ENV=production \
	TALQO_DOCS_PORT=3002

# The SSR bundle is built with noExternal, so `dist` is the only thing it needs at runtime.
COPY --from=build /app/apps/docs/dist ./apps/docs/dist
COPY --from=build /app/apps/docs/src/serve.ts ./apps/docs/src/serve.ts

USER bun

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.TALQO_DOCS_PORT || '3002') + '/').then((r) => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["bun", "apps/docs/src/serve.ts"]
