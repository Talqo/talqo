import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")

async function run(command: string[]): Promise<void> {
	const process = Bun.spawn(command, {
		cwd: root,
		env: { ...Bun.env },
		stderr: "inherit",
		stdout: "inherit",
	})
	const exitCode = await process.exited
	if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with ${exitCode}`)
}

await run(["bun", "run", "--cwd", "apps/api", "openapi:generate"])
await run(["bunx", "oxfmt", "apps/api/openapi.json"])
await run(["bunx", "orval", "--config", "orval.config.ts", "--fail-on-warnings"])
await run(["bunx", "oxfmt", "apps/web/src/api/generated"])
