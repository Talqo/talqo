import { describe, expect, it } from "bun:test"

import { app } from "./app.ts"
import { createOpenApiDocument } from "./openapi.ts"

describe("api", () => {
	it("reports its health", async () => {
		const response = await app.request("/health")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: "ok" })
	})

	it("describes every route through OpenAPI 3.1.1", () => {
		expect("getOpenAPI31Document" in app).toBe(true)

		const document = createOpenApiDocument()
		const paths = document.paths ?? {}

		expect(document.openapi).toBe("3.1.1")
		expect(Object.keys(paths).toSorted()).toEqual(
			[
				"/api/auth/login",
				"/api/auth/logout",
				"/api/auth/session",
				"/api/invitations",
				"/api/invitations/redeem",
				"/api/me",
				"/api/me/password",
				"/api/permission-grants",
				"/api/permission-grants/{id}",
				"/api/setup",
				"/api/users/{userId}/password",
				"/health",
			].toSorted(),
		)

		const operationIds = Object.values(paths).flatMap((operations) =>
			Object.values(operations).flatMap((operation) => operation.operationId ?? []),
		)
		expect(new Set(operationIds).size).toBe(operationIds.length)
		expect(operationIds.every((operationId) => operationId.length > 0)).toBe(true)
	})
})
