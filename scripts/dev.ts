import { $ } from "bun"

const DEV_APP_SECRET_BYTES = 32
const INTERRUPT_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const
const DEV_APP_SECRET = Buffer.alloc(DEV_APP_SECRET_BYTES, 1).toString("base64url")
const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const appSecret = Bun.env.APP_SECRET ?? DEV_APP_SECRET
const reservations = Array.from({ length: 3 }, () =>
	Bun.serve({ fetch: () => new Response(), hostname: "0.0.0.0", port: 0 }),
)
const [apiPort, webPort, widgetPort] = reservations.map(({ port }) => String(port))

let composeUp: Promise<unknown> = Promise.resolve()
let teardown: Promise<unknown> | undefined
// Detached so a second Ctrl-C cannot kill the teardown client halfway.
const stopContainers = () =>
	(teardown ??= Bun.spawn(["docker", "compose", "down"], {
		cwd: root,
		detached: true,
		stderr: "inherit",
		stdin: "ignore",
		stdout: "inherit",
	}).exited)

for (const [signal, code] of Object.entries(INTERRUPT_EXIT_CODES)) {
	// Wait for startup to settle before sweeping, and let every press share one teardown.
	process.on(signal, async () => {
		await composeUp.catch(() => {})
		await stopContainers()
		process.exit(code)
	})
}

try {
	composeUp = $`docker compose up --detach --wait --wait-timeout 30 postgres docling`.cwd(root)
	await composeUp
	const address = await $`docker compose port postgres 5432`.cwd(root).quiet().text()
	const databasePort = address.trim().split(":").at(-1)
	if (!databasePort) throw new Error("PostgreSQL did not expose its port")
	const doclingAddress = await $`docker compose port docling 5001`.cwd(root).quiet().text()
	const doclingPort = doclingAddress.trim().split(":").at(-1)
	if (!doclingPort) throw new Error("Docling Serve did not expose its HTTP port")
	const doclingUrl = `http://127.0.0.1:${doclingPort}`
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
} finally {
	await stopContainers()
}
