import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const temporaryDirectory = await mkdtemp(join(tmpdir(), "talqo-contracts-"))

async function filesIn(directory: string): Promise<Map<string, string>> {
	const files = new Map<string, string>()
	for await (const file of new Bun.Glob("**/*").scan({ cwd: directory, absolute: true, onlyFiles: true })) {
		files.set(relative(directory, file), await Bun.file(file).text())
	}
	return files
}

async function compareDirectories(expected: string, actual: string): Promise<string[]> {
	const expectedFiles = await filesIn(expected)
	const actualFiles = await filesIn(actual)
	const paths = new Set([...expectedFiles.keys(), ...actualFiles.keys()])
	return [...paths].filter((path) => expectedFiles.get(path) !== actualFiles.get(path)).toSorted()
}

try {
	const specification = join(temporaryDirectory, "openapi.json")
	const client = join(temporaryDirectory, "generated")
	const generator = Bun.spawn(["bun", "run", "scripts/generate-contracts.ts", specification, client], {
		cwd: root,
		stderr: "inherit",
		stdout: "inherit",
	})
	const exitCode = await generator.exited
	if (exitCode !== 0) throw new Error(`Contract generation exited with ${exitCode}`)

	const stale = []
	if ((await Bun.file(resolve(root, "apps/api/openapi.json")).text()) !== (await Bun.file(specification).text())) {
		stale.push("apps/api/openapi.json")
	}
	stale.push(
		...(await compareDirectories(resolve(root, "apps/web/src/api/generated"), client)).map(
			(path) => `apps/web/src/api/generated/${path}`,
		),
	)

	if (stale.length > 0) {
		throw new Error(
			`Generated contracts are stale:\n${stale.map((path) => `- ${path}`).join("\n")}\nRun bun run contracts:generate.`,
		)
	}
} finally {
	await rm(temporaryDirectory, { force: true, recursive: true })
}
