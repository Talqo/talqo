import { $ } from "bun"

const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const appSecret = Bun.env.APP_SECRET
if (!appSecret) {
	throw new Error("APP_SECRET is required. Generate one with: openssl rand -base64 32 | tr '+/' '-_' | tr -d '='")
}
const reservations = Array.from({ length: 3 }, () =>
	Bun.serve({ fetch: () => new Response(), hostname: "0.0.0.0", port: 0 }),
)
const [apiPort, webPort, widgetPort] = reservations.map(({ port }) => String(port))

await $`docker compose up --detach --wait --wait-timeout 30 postgres`.cwd(root)
const address = await $`docker compose port postgres 5432`.cwd(root).quiet().text()
const databasePort = address.trim().split(":").at(-1)
const databaseUrl = `postgres://talqo:talqo@127.0.0.1:${databasePort}/talqo`
const devEnv = {
	...Bun.env,
	APP_SECRET: appSecret,
	DATABASE_URL: databaseUrl,
	NODE_ENV: "development",
}

for (const reservation of reservations) reservation.stop(true)

await $`bun run db:migrate`.cwd(`${root}/apps/api`).env(devEnv)

const turbo = Bun.spawn(
	["turbo", "run", "dev", "--filter=@talqo/api", "--filter=@talqo/web", "--filter=@talqo/widget", "--ui=tui"],
	{
		cwd: root,
		env: {
			...devEnv,
			TALQO_API_PORT: apiPort,
			TALQO_WEB_PORT: webPort,
			TALQO_WIDGET_PORT: widgetPort,
			VITE_WIDGET_PREVIEW_URL: `http://localhost:${widgetPort}/preview.html`,
			VITE_WIDGET_CDN_URL: `http://localhost:${widgetPort}/widget.js`,
		},
		stderr: "inherit",
		stdin: "inherit",
		stdout: "inherit",
	},
)

process.exitCode = await turbo.exited
