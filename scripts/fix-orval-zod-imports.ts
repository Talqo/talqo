import { resolve } from "node:path"

export function promoteZodImports(source: string): string {
	const lines = source.split("\n")
	let importStart: number | undefined

	for (const [index, line] of lines.entries()) {
		if (line.startsWith("import type {")) importStart = index
		if (importStart === undefined || !/}\s+from\s+["']/.test(line)) continue

		if (/from ["']\.\.\/models(?:\/|["'])/.test(line)) {
			lines[importStart] = lines[importStart]?.replace("import type", "import") ?? lines[importStart]
		}
		importStart = undefined
	}

	return lines.join("\n")
}

export async function fixOrvalZodImports(target: string): Promise<number> {
	const directory = resolve(target)
	const files = new Bun.Glob("**/*.ts").scan({ cwd: directory, absolute: true })
	let changedFiles = 0
	for await (const file of files) {
		if (file.includes("/models/")) continue
		const source = await Bun.file(file).text()
		const transformed = promoteZodImports(source)
		if (transformed !== source) {
			await Bun.write(file, transformed)
			changedFiles += 1
		}
	}
	return changedFiles
}
