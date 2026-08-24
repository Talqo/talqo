import { $ } from "bun"

import { withTestDatabase } from "./test-database.ts"

const RESERVED_PORT_COUNT = 4
const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const apiDirectory = `${root}/apps/api`
const e2eDirectory = `${root}/apps/e2e`
const reservations = Array.from({ length: RESERVED_PORT_COUNT }, () =>
	Bun.serve({ fetch: () => new Response(), hostname: "0.0.0.0", port: 0 }),
)
const [apiPort, webPort, widgetPort, providerPort] = reservations.map(({ port }) => String(port))

function releasePorts() {
	for (const reservation of reservations.splice(0)) reservation.stop(true)
}

if (!apiPort || !webPort || !widgetPort || !providerPort) throw new Error("Could not reserve E2E application ports")

await withTestDatabase(async (databaseEnv) => {
	const env = {
		...databaseEnv,
		TALQO_API_PORT: apiPort,
		TALQO_WEB_PORT: webPort,
		TALQO_WIDGET_PORT: widgetPort,
		E2E_PROVIDER_PORT: providerPort,
		E2E_PROVIDER_URL: `http://127.0.0.1:${providerPort}/v1`,
		E2E_OPERATOR_PASSWORD: "correct-horse-battery-staple",
		E2E_ADMIN_USERNAME: "e2e_admin",
		E2E_GRANTED_USERNAME: "e2e_granted",
		E2E_UNGRANTED_USERNAME: "e2e_ungranted",
		TALQO_SEED_PROFILE: "e2e",
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
