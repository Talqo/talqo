import { parseSync } from "oxc-parser"

type ModuleImport = {
	sourceFile: string
	sourceModule: string
	specifier: string
}

const moduleImportPattern = /^@\/modules\/([^/]+)\/(.+)$/
const sourceModulePattern = /^src\/modules\/([^/]+)\/(.+\.(?:ts|tsx))$/

function parseModuleImport(specifier: string) {
	const match = moduleImportPattern.exec(specifier)

	if (!match) return undefined
	const [, module, path] = match
	if (!module || !path) return undefined

	return {
		module,
		path: path.replace(/\.(?:[cm]?[jt]sx?)$/, ""),
	}
}

export function validateModuleImport(dependency: ModuleImport): string | undefined {
	const target = parseModuleImport(dependency.specifier)

	if (!target || target.module === dependency.sourceModule) return undefined
	if (target.path === `${target.module}.service`) return undefined

	const isSchemaImport =
		dependency.sourceFile === `${dependency.sourceModule}.schema.ts` && target.path === `${target.module}.schema`

	if (isSchemaImport) return undefined

	return `Cross-module imports from ${dependency.sourceModule} to ${target.module} must target @/modules/${target.module}/${target.module}.service`
}

export function findModuleCycles(dependencies: ReadonlyMap<string, ReadonlySet<string>>): string[] {
	const cycles = new Set<string>()
	const visited = new Set<string>()
	const active = new Map<string, number>()
	const path: string[] = []

	function visit(module: string) {
		visited.add(module)
		active.set(module, path.length)
		path.push(module)

		for (const dependency of [...(dependencies.get(module) ?? [])].toSorted()) {
			const cycleStart = active.get(dependency)

			if (cycleStart !== undefined) {
				cycles.add([...path.slice(cycleStart), dependency].join(" -> "))
			} else if (!visited.has(dependency)) {
				visit(dependency)
			}
		}

		path.pop()
		active.delete(module)
	}

	for (const module of [...dependencies.keys()].toSorted()) {
		if (!visited.has(module)) visit(module)
	}

	return [...cycles]
}

export async function checkBoundaries(root = process.cwd()) {
	const violations: string[] = []
	const dependencies = new Map<string, Set<string>>()
	const glob = new Bun.Glob("src/modules/**/*.{ts,tsx}")

	for await (const filePath of glob.scan({ cwd: root, onlyFiles: true })) {
		const sourceMatch = sourceModulePattern.exec(filePath)

		if (!sourceMatch) continue

		const [, sourceModule, sourceFile] = sourceMatch
		if (!sourceModule || !sourceFile) continue
		const source = await Bun.file(`${root}/${filePath}`).text()
		const parsed = parseSync(filePath, source)
		const imports = [
			...parsed.module.staticImports.map((importedFile) => importedFile.moduleRequest.value),
			...parsed.module.staticExports.flatMap((exportedFile) =>
				exportedFile.entries.flatMap((entry) => (entry.moduleRequest ? [entry.moduleRequest.value] : [])),
			),
			...parsed.module.dynamicImports.map((importedFile) =>
				source.slice(importedFile.moduleRequest.start + 1, importedFile.moduleRequest.end - 1),
			),
		]

		for (const specifier of imports) {
			const violation = validateModuleImport({
				sourceFile,
				sourceModule,
				specifier,
			})

			if (violation) violations.push(`${filePath}: ${violation}`)

			const target = parseModuleImport(specifier)
			if (target && target.module !== sourceModule && target.path === `${target.module}.service`) {
				const moduleDependencies = dependencies.get(sourceModule) ?? new Set()
				moduleDependencies.add(target.module)
				dependencies.set(sourceModule, moduleDependencies)
			}
		}
	}

	for (const cycle of findModuleCycles(dependencies)) {
		violations.push(`Circular module dependency: ${cycle}`)
	}

	return violations
}

if (import.meta.main) {
	const violations = await checkBoundaries()

	if (violations.length > 0) {
		for (const violation of violations) console.error(violation)
		process.exit(1)
	}

	console.log("Module boundaries valid")
}
