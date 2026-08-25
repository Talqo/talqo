import { $, Glob } from "bun"
import { dirname, sep } from "node:path"

// Every workspace must carry its structural tag or `turbo boundaries` silently exempts it.
const TAG_BY_WORKSPACE_ROOT = { apps: "app", packages: "package" }

const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const workspaces = Object.entries(TAG_BY_WORKSPACE_ROOT).flatMap(([workspaceRoot, tag]) =>
	Array.from(new Glob(`${workspaceRoot}/*/package.json`).scanSync(root), (manifest) => ({
		path: dirname(manifest).split(sep).join("/"),
		tag,
	})),
)

const problems = (
	await Promise.all(
		workspaces.map(async ({ path, tag }) => {
			const config = Bun.file(`${root}/${path}/turbo.json`)
			const tags: unknown = (await config.exists()) ? (await config.json()).tags : undefined

			if (Array.isArray(tags) && tags.includes(tag)) return undefined

			return `${path}/turbo.json must contain: { "$schema": "https://turborepo.com/schema.json", "extends": ["//"], "tags": ["${tag}"] }`
		}),
	)
).filter((problem) => problem !== undefined)

if (problems.length > 0) throw new Error(`Untagged workspaces break boundary enforcement:\n${problems.join("\n")}`)
