import { $ } from "bun"

const DEV_APP_SECRET_BYTES = 32
const DOCLING_STARTUP_TIMEOUT_MS = 120_000
const DOCLING_PROBE_TIMEOUT_MS = 2_000
const DOCLING_PROBE_INTERVAL_MS = 500
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
// Detached so a second Ctrl-C cannot kill the teardown client halfway. It never rejects, so a
// failure here cannot skip the exit path or mask an earlier error.
const stopContainers = () =>
	(teardown ??= (async () => {
		try {
			await Bun.spawn(["docker", "compose", "down"], {
				cwd: root,
				detached: true,
				stderr: "inherit",
				stdin: "ignore",
				stdout: "inherit",
			}).exited
		} catch (error) {
			console.error("docker compose down failed", error)
		}
	})())

const doclingWatch = new AbortController()
let watching: Promise<void> = Promise.resolve()
// Docling needs about half a minute to load its models and nothing needs it until a file is
// uploaded. Ingestion reports those as failed conversions, which the dashboard can retry.
// Best effort, so it reports failures instead of rejecting at the caller.
const watchDocling = async (url: string): Promise<void> => {
	const { signal } = doclingWatch
	const deadline = Date.now() + DOCLING_STARTUP_TIMEOUT_MS
	try {
		/* eslint-disable no-await-in-loop -- readiness must be polled before dependent work */
		while (!signal.aborted && Date.now() < deadline) {
			try {
				const probe = await fetch(`${url}/livez`, {
					signal: AbortSignal.any([AbortSignal.timeout(DOCLING_PROBE_TIMEOUT_MS), signal]),
				})
				if (probe.ok) {
					console.log("Docling Serve is ready")
					return
				}
			} catch {
				// Wait for the container to start accepting HTTP connections.
			}
			await Bun.sleep(DOCLING_PROBE_INTERVAL_MS)
		}
		/* eslint-enable no-await-in-loop */
		if (!signal.aborted) {
			console.warn("Docling Serve did not become ready; file conversion will fail until it does")
		}
	} catch (error) {
		console.error("Docling Serve readiness check failed", error)
	}
}

// Stop watching before sweeping, so the poll cannot hold the process open after the apps exit.
const shutdown = async (): Promise<void> => {
	doclingWatch.abort()
	await watching
	await stopContainers()
}

for (const [signal, code] of Object.entries(INTERRUPT_EXIT_CODES)) {
	// Wait for startup to settle before sweeping, and let every press share one teardown.
	process.on(signal, async () => {
		await composeUp.catch(() => {})
		await shutdown()
		process.exit(code)
	})
}

try {
	// Detached so Ctrl-C cannot kill this client after the daemon accepted its creates.
	const up = Bun.spawn(
		["docker", "compose", "up", "--detach", "--wait", "--wait-timeout", "30", "postgres", "docling"],
		{ cwd: root, detached: true, stderr: "inherit", stdin: "ignore", stdout: "inherit" },
	)
	composeUp = up.exited
	const upExitCode = await composeUp
	if (upExitCode !== 0) throw new Error(`docker compose up exited with code ${upExitCode}`)
	const address = await $`docker compose port postgres 5432`.cwd(root).quiet().text()
	const databasePort = address.trim().split(":").at(-1)
	if (!databasePort) throw new Error("PostgreSQL did not expose its port")
	const doclingAddress = await $`docker compose port docling 5001`.cwd(root).quiet().text()
	const doclingPort = doclingAddress.trim().split(":").at(-1)
	if (!doclingPort) throw new Error("Docling Serve did not expose its HTTP port")
	const doclingUrl = `http://127.0.0.1:${doclingPort}`
	watching = watchDocling(doclingUrl)
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
	await shutdown()
}
