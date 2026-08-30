import { $ } from "bun"

import { withTestDatabase } from "./test-database.ts"

const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const apiDirectory = `${root}/apps/api`

await withTestDatabase(async (env) => {
	await $`bun run db:migrate`.cwd(apiDirectory).env(env)
	// agent-files.preload redirects TALQO_UPLOAD_DIR before the env singleton caches it.
	await $`bun test --preload ./src/modules/agent-files/agent-files.preload.ts integration.test.ts`
		.cwd(apiDirectory)
		.env(env)
})
