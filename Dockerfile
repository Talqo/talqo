# Required runtime env: APP_SECRET, DATABASE_URL, TALQO_DOCLING_URL.

FROM oven/bun:1.4.3 AS build

WORKDIR /app

# Dependency manifests first so source-only changes reuse the install layer.
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/widget/package.json ./apps/widget/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/shared/package.json ./packages/shared/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/ui/package.json ./packages/ui/

RUN --mount=type=cache,target=/root/.bun/install/cache \
	bun install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages

RUN bunx turbo run build --filter=@talqo/api --filter=@talqo/web --filter=@talqo/widget

FROM oven/bun:1.4.3-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/Talqo/talqo"

WORKDIR /app

ENV NODE_ENV=production \
	TALQO_SERVE_STATIC=true \
	TALQO_UPLOAD_DIR=/data/uploads \
	TALQO_WEB_DIST=/app/apps/web/dist \
	TALQO_WIDGET_DIST=/app/apps/widget/dist

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/widget/dist ./apps/widget/dist

# Fresh named volumes mounted here inherit this dir's owner.
RUN mkdir -p /data/uploads && chown bun:bun /data/uploads

USER bun

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
	CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.TALQO_API_PORT || '3000') + '/health').then((r) => { if (!r.ok) process.exit(1) })"]

CMD ["sh", "-c", "bun apps/api/dist/db/migrate.js && exec bun apps/api/dist/index.js"]
