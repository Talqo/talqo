import { describe, expect, test } from "bun:test"

import { includedPermissions, type PermissionCatalog } from "./role-form.ts"

const CATALOG: PermissionCatalog = [
	{ permission: "users:read", implies: [] },
	{ permission: "users:manage", implies: ["users:read"] },
	{ permission: "roles:manage", implies: ["users:read"] },
]

describe("includedPermissions", () => {
	test("includes no implications without selected permissions", () => {
		expect(includedPermissions([], CATALOG)).toEqual(new Map())
	})

	test("attributes a shared implication to the first selected catalog entry", () => {
		expect(includedPermissions(["users:manage", "roles:manage"], CATALOG)).toEqual(
			new Map([["users:read", "users:manage"]]),
		)
	})
})
