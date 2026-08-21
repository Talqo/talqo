import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")

const generator = Bun.spawn(["bun", "run", "contracts:generate"], {
	cwd: root,
	stderr: "inherit",
	stdout: "inherit",
})
if ((await generator.exited) !== 0) throw new Error("Contract generation failed")

const status = Bun.spawnSync(
	["git", "status", "--porcelain", "--", "apps/api/openapi.json", "apps/web/src/api/generated"],
	{ cwd: root },
)
const changed = status.stdout.toString().trim()
if (changed) {
	throw new Error(
		`Generated contracts are stale or incomplete; commit the regenerated artifacts:\n${changed}\nRun bun run contracts:generate.`,
	)
}
