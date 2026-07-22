import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"

import { checkBoundaries, findModuleCycles, validateModuleImport } from "./check-boundaries"

describe("module boundaries", () => {
	test("allows same-module imports", () => {
		expect(
			validateModuleImport({
				sourceFile: "accounts.service.ts",
				sourceModule: "accounts",
				specifier: "@/modules/accounts/accounts.repository",
			}),
		).toBeUndefined()
	})

	test("allows another module service", () => {
		expect(
			validateModuleImport({
				sourceFile: "accounts.service.ts",
				sourceModule: "accounts",
				specifier: "@/modules/billing/billing.service",
			}),
		).toBeUndefined()
	})

	test("rejects another module implementation", () => {
		expect(
			validateModuleImport({
				sourceFile: "accounts.service.ts",
				sourceModule: "accounts",
				specifier: "@/modules/billing/billing.repository",
			}),
		).toContain("billing.service")
	})

	test("allows schema imports only between schema files", () => {
		expect(
			validateModuleImport({
				sourceFile: "accounts.schema.ts",
				sourceModule: "accounts",
				specifier: "@/modules/billing/billing.schema",
			}),
		).toBeUndefined()

		expect(
			validateModuleImport({
				sourceFile: "accounts.service.ts",
				sourceModule: "accounts",
				specifier: "@/modules/billing/billing.schema",
			}),
		).toContain("billing.service")
	})

	test("finds cycles between modules", () => {
		const dependencies = new Map([
			["accounts", new Set(["billing"])],
			["billing", new Set(["accounts"])],
		])

		expect(findModuleCycles(dependencies)).toEqual(["accounts -> billing -> accounts"])
	})

	test("checks imports from module source files", async () => {
		const root = await mkdtemp(`${tmpdir()}/talqo-boundaries-`)

		try {
			await mkdir(`${root}/src/modules/accounts`, { recursive: true })
			await writeFile(
				`${root}/src/modules/accounts/accounts.service.ts`,
				'import "@/modules/billing/billing.repository"',
			)

			expect(await checkBoundaries(root)).toEqual([
				"src/modules/accounts/accounts.service.ts: Cross-module imports from accounts to billing must target @/modules/billing/billing.service",
			])
		} finally {
			await rm(root, { force: true, recursive: true })
		}
	})
})
