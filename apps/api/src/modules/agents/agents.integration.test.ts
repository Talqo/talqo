import { app } from "@/app.ts"
import { env } from "@/config/env.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { describe, expect, it } from "bun:test"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

type AgentBody = {
	id: string
	name: string
	systemPrompt: string
	wordBlacklist: string[]
	status: "active" | "paused"
}

type AgentFileBody = {
	name: string
	sizeBytes: number
	createdAt: string
}

function extractSessionCookie(response: Response): string {
	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) throw new Error("Expected a Set-Cookie header")
	const [cookiePair] = setCookie.split(";")
	if (!cookiePair) throw new Error("Malformed Set-Cookie header")
	return cookiePair
}

async function createAndLogin() {
	const username = uniqueUsername()
	await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	const response = await app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password: DEFAULT_PASSWORD }),
	})
	return { cookie: extractSessionCookie(response) }
}

function uniqueAgentName(): string {
	return `agent_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
}

async function createAgent(cookie: string, name: string): Promise<AgentBody> {
	const response = await app.request("/api/agents", {
		method: "POST",
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	})
	expect(response.status).toBe(201)
	const { agent } = (await response.json()) as { agent: AgentBody }
	return agent
}

function uploadForm(content: string, filename = "context.txt", type = "text/plain"): FormData {
	const form = new FormData()
	form.append("file", new File([content], filename, { type }))
	return form
}

describe("agents", () => {
	it("creates, reads, updates, lists, and deletes an agent", async () => {
		const { cookie } = await createAndLogin()
		const name = uniqueAgentName()

		const agent = await createAgent(cookie, name)
		expect(agent).toMatchObject({
			name,
			status: "active",
			systemPrompt: "",
			wordBlacklist: [],
		})

		const getResponse = await app.request(`/api/agents/${agent.id}`, { headers: { Cookie: cookie } })
		expect(getResponse.status).toBe(200)

		const patchResponse = await app.request(`/api/agents/${agent.id}`, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ systemPrompt: "Be terse.", wordBlacklist: ["spam", "abuse"], active: false }),
		})
		expect(patchResponse.status).toBe(200)
		const { agent: updated } = (await patchResponse.json()) as { agent: AgentBody }
		expect(updated).toMatchObject({ systemPrompt: "Be terse.", wordBlacklist: ["spam", "abuse"], status: "paused" })

		const listResponse = await app.request("/api/agents", { headers: { Cookie: cookie } })
		const { agents } = (await listResponse.json()) as { agents: AgentBody[] }
		expect(agents.map((a) => a.id)).toContain(agent.id)

		const deleteResponse = await app.request(`/api/agents/${agent.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		})
		expect(deleteResponse.status).toBe(204)

		const goneResponse = await app.request(`/api/agents/${agent.id}`, { headers: { Cookie: cookie } })
		expect(goneResponse.status).toBe(404)
	})

	it("rejects duplicate agent names for the same owner but allows them across owners", async () => {
		const first = await createAndLogin()
		const second = await createAndLogin()
		const name = uniqueAgentName()
		await createAgent(first.cookie, name)

		const duplicate = await app.request("/api/agents", {
			method: "POST",
			headers: { Cookie: first.cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		})
		expect(duplicate.status).toBe(409)

		const otherOwner = await app.request("/api/agents", {
			method: "POST",
			headers: { Cookie: second.cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		})
		expect(otherOwner.status).toBe(201)
	})

	it("returns 404 for other users' agents on every route", async () => {
		const owner = await createAndLogin()
		const outsider = await createAndLogin()
		const agent = await createAgent(owner.cookie, uniqueAgentName())

		const attempts = [
			["GET", `/api/agents/${agent.id}`, undefined],
			["PATCH", `/api/agents/${agent.id}`, JSON.stringify({ name: "hijack" })],
			["DELETE", `/api/agents/${agent.id}`, undefined],
			["GET", `/api/agents/${agent.id}/files`, undefined],
		] as const
		const responses = await Promise.all(
			attempts.map(([method, path, body]) =>
				app.request(path, {
					method,
					headers: { Cookie: outsider.cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
					body,
				}),
			),
		)
		for (const response of responses) {
			expect(response.status).toBe(404)
		}
	})

	it("uploads, lists, and deletes a context file, storing it on disk under the agent's directory", async () => {
		const { cookie } = await createAndLogin()
		const agent = await createAgent(cookie, uniqueAgentName())

		const uploadResponse = await app.request(`/api/agents/${agent.id}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("Refund policy: 30 days."),
		})
		expect(uploadResponse.status).toBe(201)
		const { file } = (await uploadResponse.json()) as { file: AgentFileBody }
		expect(file).toMatchObject({ name: "context.txt" })
		expect(file.sizeBytes).toBeGreaterThan(0)

		const stored = await readdir(join(env.TALQO_UPLOAD_DIR, agent.id))
		expect(stored).toEqual(["context.txt"])

		const listResponse = await app.request(`/api/agents/${agent.id}/files`, { headers: { Cookie: cookie } })
		const { files } = (await listResponse.json()) as { files: AgentFileBody[] }
		expect(files.map((f) => f.name)).toEqual([file.name])

		const deleteResponse = await app.request(`/api/agents/${agent.id}/files/${file.name}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		})
		expect(deleteResponse.status).toBe(204)

		const emptyResponse = await app.request(`/api/agents/${agent.id}/files`, { headers: { Cookie: cookie } })
		const { files: remaining } = (await emptyResponse.json()) as { files: AgentFileBody[] }
		expect(remaining).toEqual([])
	})

	it("rejects uploading two files with the same name", async () => {
		const { cookie } = await createAndLogin()
		const agent = await createAgent(cookie, uniqueAgentName())

		const first = await app.request(`/api/agents/${agent.id}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("first"),
		})
		expect(first.status).toBe(201)

		const second = await app.request(`/api/agents/${agent.id}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("second"),
		})
		expect(second.status).toBe(409)
	})

	it("renames a context file, keeping the original extension", async () => {
		const { cookie } = await createAndLogin()
		const agent = await createAgent(cookie, uniqueAgentName())

		const uploadResponse = await app.request(`/api/agents/${agent.id}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("Refund policy: 30 days."),
		})
		const { file } = (await uploadResponse.json()) as { file: AgentFileBody }

		const renameResponse = await app.request(`/api/agents/${agent.id}/files/${file.name}`, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Refund Policy" }),
		})
		expect(renameResponse.status).toBe(200)
		const { file: renamed } = (await renameResponse.json()) as { file: AgentFileBody }
		expect(renamed.name).toBe("Refund Policy.txt")
		expect(renamed.sizeBytes).toBe(file.sizeBytes)

		const emptyName = await app.request(`/api/agents/${agent.id}/files/${renamed.name}`, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name: "   " }),
		})
		expect(emptyName.status).toBe(400)
	})

	it("rejects file names that could escape the agent directory", async () => {
		const { cookie } = await createAndLogin()
		const agent = await createAgent(cookie, uniqueAgentName())

		const responses = await Promise.all(
			["../escape.txt", "nested/dir.txt"].map((name) =>
				app.request(`/api/agents/${agent.id}/files`, {
					method: "POST",
					headers: { Cookie: cookie },
					body: uploadForm("payload", name),
				}),
			),
		)
		for (const response of responses) {
			expect(response.status).toBe(400)
		}
	})

	it("rejects URL-encoded path traversal in file delete and rename names", async () => {
		const { cookie } = await createAndLogin()
		const agent = await createAgent(cookie, uniqueAgentName())

		// Guard: a real file outside the agent dir must survive all attempts.
		await mkdir(env.TALQO_UPLOAD_DIR, { recursive: true })
		const guardPath = join(env.TALQO_UPLOAD_DIR, "guard.txt")
		await writeFile(guardPath, "must survive")

		const encoded = encodeURIComponent("../../guard.txt")
		const [deleteResp, renameResp] = await Promise.all([
			app.request(`/api/agents/${agent.id}/files/${encoded}`, { method: "DELETE", headers: { Cookie: cookie } }),
			app.request(`/api/agents/${agent.id}/files/${encoded}`, {
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ name: "renamed.txt" }),
			}),
		])
		expect(deleteResp.status).toBe(400)
		expect(renameResp.status).toBe(400)

		// Defense-in-depth: even though 400 was returned, verify nothing outside the agent dir was touched.
		expect(await readFile(guardPath, "utf8")).toBe("must survive")
	})

	it("rejects files over the size limit", async () => {
		const { cookie } = await createAndLogin()
		const agent = await createAgent(cookie, uniqueAgentName())

		// One byte over the configured limit rejects without allocating a large binary blob.
		const tooBig = await app.request(`/api/agents/${agent.id}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("x".repeat(env.TALQO_MAX_FILE_SIZE_MB * 1024 * 1024 + 1)),
		})
		expect(tooBig.status).toBe(400)
	})

	it("removes uploaded files from disk when the agent is deleted", async () => {
		const { cookie } = await createAndLogin()
		const agent = await createAgent(cookie, uniqueAgentName())

		const uploadResponse = await app.request(`/api/agents/${agent.id}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("context"),
		})
		expect(uploadResponse.status).toBe(201)

		const before = await readdir(env.TALQO_UPLOAD_DIR)
		expect(before.length).toBeGreaterThan(0)

		const deleteResponse = await app.request(`/api/agents/${agent.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		})
		expect(deleteResponse.status).toBe(204)

		const after = await readdir(env.TALQO_UPLOAD_DIR)
		expect(after.length).toBe(before.length - 1)
	})
})
