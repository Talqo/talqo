import { $ } from "bun"

const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const reservations = Array.from({ length: 3 }, () =>
	Bun.serve({ fetch: () => new Response(), hostname: "0.0.0.0", port: 0 }),
)
const [apiPort, webPort, widgetPort] = reservations.map(({ port }) => String(port))

await $`docker compose up --detach --wait --wait-timeout 30 postgres`.cwd(root)
const address = await $`docker compose port postgres 5432`.cwd(root).quiet().text()
const databasePort = address.trim().split(":").at(-1)

for (const reservation of reservations) reservation.stop(true)
const turbo = Bun.spawn(
	["turbo", "run", "dev", "--filter=@talqo/api", "--filter=@talqo/web", "--filter=@talqo/widget", "--ui=tui"],
	{
		cwd: root,
		env: {
			...Bun.env,
			DATABASE_URL: `postgres://talqo:talqo@127.0.0.1:${databasePort}/talqo`,
			TALQO_API_PORT: apiPort,
			TALQO_WEB_PORT: webPort,
			TALQO_WIDGET_PORT: widgetPort,
			// Point the dashboard's preview iframe and embed snippet at the
			// reserved widget dev port.
			VITE_WIDGET_PREVIEW_URL: `http://localhost:${widgetPort}/preview.html`,
			VITE_WIDGET_CDN_URL: `http://localhost:${widgetPort}/widget.js`,
		},
		stderr: "inherit",
		stdin: "inherit",
		stdout: "inherit",
	},
)

process.exitCode = await turbo.exited
