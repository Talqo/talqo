import { app } from "@/app.ts"
import { describe, expect, it } from "bun:test"

const AGENT_ID = crypto.randomUUID()

describe("agent-files routes", () => {
	it("rejects unauthenticated file listing", async () => {
		const response = await app.request(`/api/agents/${AGENT_ID}/files`)
		expect(response.status).toBe(401)
	})

	it("rejects unauthenticated file upload", async () => {
		const form = new FormData()
		form.append("file", new File(["x"], "a.md", { type: "text/markdown" }))
		const response = await app.request(`/api/agents/${AGENT_ID}/files`, { method: "POST", body: form })
		expect(response.status).toBe(401)
	})

	it("rejects unauthenticated file rename", async () => {
		const response = await app.request(`/api/agents/${AGENT_ID}/files/a.md`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "b.md" }),
		})
		expect(response.status).toBe(401)
	})

	it("rejects unauthenticated file delete", async () => {
		const response = await app.request(`/api/agents/${AGENT_ID}/files/a.md`, { method: "DELETE" })
		expect(response.status).toBe(401)
	})
})
