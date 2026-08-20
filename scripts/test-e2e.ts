import { $ } from "bun"

import { withTestDatabase } from "./test-database.ts"

const RESERVED_PORT_COUNT = 3
const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const apiDirectory = `${root}/apps/api`
const e2eDirectory = `${root}/apps/e2e`
const reservations = Array.from({ length: RESERVED_PORT_COUNT }, () =>
	Bun.serve({ fetch: () => new Response(), hostname: "0.0.0.0", port: 0 }),
)
const [apiPort, webPort, widgetPort] = reservations.map(({ port }) => String(port))

type SeedResult = {
	operator: { password: string; username: string }
	widgetToken: string
}

function seedResult(output: string): SeedResult {
	const line = output.trim().split("\n").at(-1)
	if (!line) throw new Error("db:seed produced no output to hand to Playwright")
	return JSON.parse(line) as SeedResult
}

function releasePorts() {
	for (const reservation of reservations.splice(0)) reservation.stop(true)
}

if (!apiPort || !webPort || !widgetPort) throw new Error("Could not reserve E2E application ports")

await withTestDatabase(async (databaseEnv) => {
	const env = {
		...databaseEnv,
		TALQO_API_PORT: apiPort,
		TALQO_WEB_PORT: webPort,
		TALQO_WIDGET_PORT: widgetPort,
	}

	try {
		await $`bun run db:migrate`.cwd(apiDirectory).env(env)
		// The seed prints its records as one JSON line; Playwright reads them from the
		// environment so apps/e2e never has to import API source or define records itself.
		const seeded = seedResult(await $`bun run db:seed`.cwd(apiDirectory).env(env).text())
		releasePorts()
		await $`bunx playwright test --project=chromium`.cwd(e2eDirectory).env({
			...env,
			E2E_OPERATOR_USERNAME: seeded.operator.username,
			E2E_OPERATOR_PASSWORD: seeded.operator.password,
			E2E_WIDGET_TOKEN: seeded.widgetToken,
		})
	} finally {
		releasePorts()
	}
})
