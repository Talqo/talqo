/* eslint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- scripts/ has no tsconfig, so type-aware rules cannot resolve node: builtin types here */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const API_SRC = join(REPO_ROOT, "apps", "api", "src")
const MODULES_PREFIX = "apps/api/src/modules/"
const ALIAS = "@/"

const RECORDED_EXCEPTIONS = [
	{
		importer: "apps/api/src/modules/conversation/conversation.repository.ts",
		target: "apps/api/src/modules/embed/embed.schema.ts",
		reason:
			"Recorded in docs/architecture.md (Module Boundaries): the acceptance transaction row-locks EMBED so embed validity, access version, and the disabled flag hold atomically at acceptance, and findConversationById joins EMBED (id and access version) to validate the chat credential; transactions cannot flow through service APIs. Remove when the recorded exceptions are removed.",
	},
]

const IMPORT_CLAUSE = "(?:[A-Za-z_$][\\w$]*|\\*(?:\\s*as\\s+[A-Za-z_$][\\w$]*)?|\\{[^}]*\\})"
const STATIC_IMPORT_RE = new RegExp(
	`(?:^|[^\\w$.])(import|export)\\s+(type\\s+)?(?:${IMPORT_CLAUSE}\\s*,\\s*)?${IMPORT_CLAUSE}?\\s*from\\s*["']([^"']+)["']`,
	"g",
)
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g

function toPosix(path) {
	return path.split(sep).join("/")
}

function isTestName(name) {
	return name.startsWith("test") || name.endsWith(".test.ts")
}

function listSourceFiles(dir) {
	const files = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (!isTestName(entry.name)) files.push(...listSourceFiles(path))
		} else if (entry.isFile() && entry.name.endsWith(".ts") && !isTestName(entry.name)) {
			files.push(path)
		}
	}
	return files.toSorted((a, b) => a.localeCompare(b))
}

function moduleOfPath(relPath) {
	if (!relPath.startsWith(MODULES_PREFIX)) return null
	const rest = relPath.slice(MODULES_PREFIX.length)
	const separator = rest.indexOf("/")
	if (separator === -1) return null
	return rest.slice(0, separator)
}

function resolveSpecifier(specifier, importerPath) {
	let absolute = null
	if (specifier.startsWith(ALIAS)) {
		absolute = resolve(API_SRC, specifier.slice(ALIAS.length))
	} else if (specifier.startsWith("./") || specifier.startsWith("../")) {
		absolute = resolve(dirname(importerPath), specifier)
	} else {
		return null
	}
	let stats = null
	try {
		stats = statSync(absolute)
	} catch {
		stats = null
	}
	if (stats?.isDirectory()) absolute = join(absolute, "index.ts")
	let relPath = toPosix(relative(REPO_ROOT, absolute))
	if (!relPath.endsWith(".ts")) relPath = `${relPath}.ts`
	return relPath
}

function extractImports(source) {
	const imports = []
	for (const match of source.matchAll(STATIC_IMPORT_RE)) {
		imports.push({ specifier: match[3], typeOnly: Boolean(match[2]) })
	}
	for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
		imports.push({ specifier: match[1], typeOnly: false })
	}
	return imports
}

function describeViolation(importer, specifier, target) {
	const targetModule = moduleOfPath(target)
	const targetName = basename(target)
	const importerName = basename(importer)
	if (targetName === `${targetModule}.schema.ts` && !importerName.endsWith(".schema.ts")) {
		return `${importer} imports "${specifier}": another module's schema is importable only from a *.schema.ts file (foreign-key declarations)`
	}
	return `${importer} imports "${specifier}": cross-module imports may target only ${targetModule}.service.ts or ${targetModule}.contract.ts`
}

function addEdge(graph, from, to) {
	if (!graph.has(from)) graph.set(from, new Set())
	graph.get(from).add(to)
}

function findCycles(modules, graph) {
	const ACTIVE = "active"
	const DONE = "done"
	const state = new Map()
	const stack = []
	const cycles = []
	const visit = (moduleName) => {
		state.set(moduleName, ACTIVE)
		stack.push(moduleName)
		for (const next of [...(graph.get(moduleName) ?? [])].toSorted((a, b) => a.localeCompare(b))) {
			const nextState = state.get(next)
			if (nextState === ACTIVE) {
				const start = stack.indexOf(next)
				cycles.push([...stack.slice(start), next].join(" -> "))
			} else if (nextState !== DONE) {
				visit(next)
			}
		}
		stack.pop()
		state.set(moduleName, DONE)
	}
	for (const moduleName of [...modules].toSorted((a, b) => a.localeCompare(b))) {
		if (!state.has(moduleName)) visit(moduleName)
	}
	return cycles
}

const modules = new Set()
const graph = new Map()
const violations = []
const appliedExceptions = new Set()

for (const file of listSourceFiles(API_SRC)) {
	const importerRel = toPosix(relative(REPO_ROOT, file))
	const importerModule = moduleOfPath(importerRel)
	if (importerModule === null) continue
	modules.add(importerModule)
	const importerName = basename(importerRel)
	const isModuleApiFile =
		importerName === `${importerModule}.service.ts` || importerName === `${importerModule}.contract.ts`
	for (const { specifier, typeOnly } of extractImports(readFileSync(file, "utf8"))) {
		const target = resolveSpecifier(specifier, file)
		if (target === null) continue
		const targetModule = moduleOfPath(target)
		if (targetModule === null || targetModule === importerModule) continue
		if (typeOnly) continue
		const targetName = basename(target)
		const serviceOrContractTarget =
			targetName === `${targetModule}.service.ts` || targetName === `${targetModule}.contract.ts`
		const schemaFromSchemaImporter = targetName === `${targetModule}.schema.ts` && importerName.endsWith(".schema.ts")
		if (serviceOrContractTarget || schemaFromSchemaImporter) {
			if (isModuleApiFile) addEdge(graph, importerModule, targetModule)
			continue
		}
		const exception = RECORDED_EXCEPTIONS.find((entry) => entry.importer === importerRel && entry.target === target)
		if (exception) {
			appliedExceptions.add(exception)
			continue
		}
		violations.push(describeViolation(importerRel, specifier, target))
	}
}

for (const exception of RECORDED_EXCEPTIONS) {
	if (!appliedExceptions.has(exception)) {
		violations.push(
			`stale recorded exception: ${exception.importer} no longer imports ${exception.target}; remove the entry`,
		)
	}
}

const cycles = findCycles(modules, graph)

for (const violation of violations) {
	console.error(`boundary violation: ${violation}`)
}
for (const cycle of cycles) {
	console.error(`module dependency cycle: ${cycle}`)
}
if (violations.length > 0 || cycles.length > 0) {
	process.exit(1)
}

let edgeCount = 0
for (const targets of graph.values()) {
	edgeCount += targets.size
}
console.log(`${modules.size} modules checked, ${edgeCount} cross-module edges, 0 violations`)
