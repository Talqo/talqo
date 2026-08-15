import { $ } from "bun"

import { withTestDatabase } from "./test-database.ts"

const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const apiDirectory = `${root}/apps/api`

await withTestDatabase(async (env) => {
	await $`bun run db:migrate`.cwd(apiDirectory).env(env)
	await $`bun test integration.test.ts`.cwd(apiDirectory).env(env)
})
