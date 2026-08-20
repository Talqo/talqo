import { resolve } from "node:path"

const specification = resolve(Bun.argv[2] ?? "apps/api/openapi.json")
const client = resolve(Bun.argv[3] ?? "apps/web/src/api/generated")

async function run(command: string[], env?: Record<string, string>): Promise<void> {
	const process = Bun.spawn(command, {
		cwd: resolve(import.meta.dirname, ".."),
		env: { ...Bun.env, ...env },
		stderr: "inherit",
		stdout: "inherit",
	})
	const exitCode = await process.exited
	if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with ${exitCode}`)
}

await run(["bun", "run", "--cwd", "apps/api", "openapi:generate"], { OPENAPI_OUTPUT: specification })
await run(["bunx", "oxfmt", specification])
await run(["bunx", "orval", "--config", "orval.config.ts", "--fail-on-warnings"], {
	ORVAL_INPUT: specification,
	ORVAL_OUTPUT: client,
})
await run(["bun", "run", "scripts/run-fix-orval-zod-imports.ts", client])
await run(["bunx", "oxfmt", client])
