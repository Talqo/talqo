import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

const CONTEXT_ID = "4f3a9d94-0d90-4d9e-a3fc-25d4ec7b6a2d"

describe("context routes", () => {
	it.each([
		["POST", "/api/context"],
		["GET", `/api/context/${CONTEXT_ID}/files`],
		["POST", `/api/context/${CONTEXT_ID}/files`],
		["PATCH", `/api/context/${CONTEXT_ID}/files/some-file.txt`],
		["DELETE", `/api/context/${CONTEXT_ID}/files/some-file.txt`],
	])("rejects an unauthenticated %s %s", async (method, path) => {
		const response = await app.request(path, { method })

		expect(response.status).toBe(401)
	})
})
