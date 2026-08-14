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
		await $`bun run db:seed`.cwd(apiDirectory).env(env)
		releasePorts()
		await $`bunx playwright test --project=chromium`.cwd(e2eDirectory).env(env)
	} finally {
		releasePorts()
	}
})
