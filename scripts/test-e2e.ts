import { $ } from "bun"

import { withTestDatabase } from "./test-database.ts"

const RESERVED_PORT_COUNT = 4
const PLAYWRIGHT_ARGUMENT_OFFSET = 2
const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const apiDirectory = `${root}/apps/api`
const e2eDirectory = `${root}/apps/e2e`
const playwrightArguments = Bun.argv.slice(PLAYWRIGHT_ARGUMENT_OFFSET)
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
		TALQO_CHAT_DAILY_MESSAGE_LIMIT: "3",
		TALQO_ALLOW_INSECURE_SEED: "true",
		E2E_PROVIDER_PORT: providerPort,
		TALQO_SEED_AI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
		TALQO_SEED_AI_API_KEY: "e2e-provider-key",
		TALQO_SEED_TEXT_MODEL: "chat-model",
		TALQO_SEED_EMBEDDING_MODEL: "embedding-model",
	}

	try {
		await $`bun run db:migrate`.cwd(apiDirectory).env(env)
		await $`bun run db:seed`.cwd(apiDirectory).env(env)
		releasePorts()
		await $`bunx playwright test --project=chromium ${playwrightArguments}`.cwd(e2eDirectory).env({
			...env,
		})
	} finally {
		releasePorts()
	}
})
