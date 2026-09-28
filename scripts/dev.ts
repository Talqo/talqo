import { $ } from "bun"

const DEV_APP_SECRET_BYTES = 32
const DOCLING_STARTUP_TIMEOUT_MS = 120_000
const DOCLING_PROBE_TIMEOUT_MS = 2_000
const DOCLING_PROBE_INTERVAL_MS = 500
const DEV_APP_SECRET = Buffer.alloc(DEV_APP_SECRET_BYTES, 1).toString("base64url")
const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const appSecret = Bun.env.APP_SECRET ?? DEV_APP_SECRET
const reservations = Array.from({ length: 3 }, () =>
	Bun.serve({ fetch: () => new Response(), hostname: "0.0.0.0", port: 0 }),
)
const [apiPort, webPort, widgetPort] = reservations.map(({ port }) => String(port))

await $`docker compose up --detach --wait --wait-timeout 30 postgres docling`.cwd(root)
const address = await $`docker compose port postgres 5432`.cwd(root).quiet().text()
const databasePort = address.trim().split(":").at(-1)
const doclingAddress = await $`docker compose port docling 5001`.cwd(root).quiet().text()
const doclingPort = doclingAddress.trim().split(":").at(-1)
if (!doclingPort) throw new Error("Docling Serve did not expose its HTTP port")
const doclingUrl = `http://127.0.0.1:${doclingPort}`
const doclingReadyDeadline = Date.now() + DOCLING_STARTUP_TIMEOUT_MS
/* eslint-disable no-await-in-loop -- readiness must be checked before starting dependent apps */
while (Date.now() < doclingReadyDeadline) {
	try {
		if ((await fetch(`${doclingUrl}/livez`, { signal: AbortSignal.timeout(DOCLING_PROBE_TIMEOUT_MS) })).ok) break
	} catch {
		// Wait for the container to start accepting HTTP connections.
	}
	await Bun.sleep(DOCLING_PROBE_INTERVAL_MS)
}
/* eslint-enable no-await-in-loop */
if (Date.now() >= doclingReadyDeadline) throw new Error("Docling Serve did not become ready")
const databaseUrl = `postgres://talqo:talqo@127.0.0.1:${databasePort}/talqo`
const devEnv = {
	...Bun.env,
	APP_SECRET: appSecret,
	DATABASE_URL: databaseUrl,
	TALQO_DOCLING_URL: doclingUrl,
	NODE_ENV: "development",
	TALQO_ALLOW_INSECURE_SEED: "true",
}

for (const reservation of reservations) reservation.stop(true)

await $`bun run db:migrate`.cwd(`${root}/apps/api`).env(devEnv)
await $`bun run db:seed`.cwd(`${root}/apps/api`).env(devEnv)

const turbo = Bun.spawn(
	["turbo", "run", "dev", "--filter=@talqo/api", "--filter=@talqo/web", "--filter=@talqo/widget", "--ui=tui"],
	{
		cwd: root,
		env: {
			...devEnv,
			TALQO_API_PORT: apiPort,
			TALQO_WEB_PORT: webPort,
			TALQO_WIDGET_PORT: widgetPort,
			VITE_WIDGET_PREVIEW_URL: `http://localhost:${widgetPort}/dev-preview.html`,
			VITE_WIDGET_CDN_URL: `http://localhost:${widgetPort}/widget.js`,
			VITE_WIDGET_DEMO_API_URL: `http://localhost:${apiPort}`,
			VITE_WIDGET_DEMO_EMBED_TOKEN: "F2qM7vR9xL4nK8pT6sW3yB5cD1hJ0uA9eG7iN2oQ4zX",
		},
		stderr: "inherit",
		stdin: "inherit",
		stdout: "inherit",
	},
)

process.exitCode = await turbo.exited
