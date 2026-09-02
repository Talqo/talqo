import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { readdir, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"

// Set by scripts/test-integration.ts; integration tests must not fall back to a directory inside src/.
const UPLOAD_ROOT = process.env.TALQO_UPLOAD_DIR
if (!UPLOAD_ROOT) throw new Error("TALQO_UPLOAD_DIR must be set; run via bun run test:integration")

async function login(username: string): Promise<string> {
	const response = await app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password: DEFAULT_PASSWORD }),
	})
	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) throw new Error("Expected a Set-Cookie header")
	const [cookiePair] = setCookie.split(";")
	if (!cookiePair) throw new Error("Malformed Set-Cookie header")
	return cookiePair
}

async function createAdminSession(): Promise<{ cookie: string; userId: string }> {
	const username = uniqueUsername()
	const admin = await roles.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	return { cookie: await login(username), userId: admin.id }
}

async function createReaderSession(grantedBy: string): Promise<string> {
	const username = uniqueUsername()
	const member = await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	await roles.grantPermission({ userId: member.id, permission: "agents:read", grantedBy })
	return login(username)
}

async function createAgent(cookie: string, name: string): Promise<string> {
	const response = await app.request("/api/agents", {
		method: "POST",
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		body: JSON.stringify({ name, systemPrompt: "Prompt", wordBlacklist: [] }),
	})
	expect(response.status).toBe(201)
	const { agent } = (await response.json()) as { agent: { id: string } }
	return agent.id
}

function upload(cookie: string, agentId: string, name = "a.md", contents = "hello") {
	const form = new FormData()
	form.append("file", new File([contents], name, { type: "text/markdown" }))
	return app.request(`/api/agents/${agentId}/files`, { method: "POST", headers: { Cookie: cookie }, body: form })
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE blacklist_word, agent, permission_grant, invitation, user_role, session, "user"`
	await rm(UPLOAD_ROOT, { force: true, recursive: true })
})

afterAll(async () => {
	await rm(UPLOAD_ROOT, { force: true, recursive: true })
})

describe("agent knowledge files", () => {
	it("uploads, lists, renames, and deletes a file end to end", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Files")

		const uploaded = await upload(cookie, agentId)
		expect(uploaded.status).toBe(201)
		const { file } = (await uploaded.json()) as { file: { name: string; sizeBytes: number; createdAt: string } }
		expect(file.name).toBe("a.md")
		expect(file.sizeBytes).toBe(5)
		expect(await readFile(join(UPLOAD_ROOT, agentId, "a.md"), "utf8")).toBe("hello")

		const listed = await app.request(`/api/agents/${agentId}/files`, { headers: { Cookie: cookie } })
		expect(listed.status).toBe(200)
		const listBody = (await listed.json()) as {
			files: { name: string; sizeBytes: number; createdAt: string }[]
			maxSizeBytes: number
			maxNameLength: number
		}
		expect(listBody.files.map((f) => f.name)).toEqual(["a.md"])
		expect(listBody.maxSizeBytes).toBeGreaterThan(0)

		const renamed = await app.request(`/api/agents/${agentId}/files/a.md`, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name: "renamed" }),
		})
		expect(renamed.status).toBe(200)
		expect(((await renamed.json()) as { file: { name: string } }).file.name).toBe("renamed.md")

		const removed = await app.request(`/api/agents/${agentId}/files/renamed.md`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		})
		expect(removed.status).toBe(204)
		const after = await app.request(`/api/agents/${agentId}/files`, { headers: { Cookie: cookie } })
		expect(((await after.json()) as { files: unknown[] }).files).toEqual([])
	})

	it("rejects a duplicate file name with 409", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Dupes")
		expect((await upload(cookie, agentId)).status).toBe(201)
		expect((await upload(cookie, agentId)).status).toBe(409)
	})

	it("rejects a disallowed file type with 400", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Types")
		const form = new FormData()
		form.append("file", new File(["x"], "run.exe", { type: "application/octet-stream" }))
		const response = await app.request(`/api/agents/${agentId}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: form,
		})
		expect(response.status).toBe(400)
	})

	it("returns 404 when the agent does not exist", async () => {
		const { cookie } = await createAdminSession()
		const response = await app.request(`/api/agents/${crypto.randomUUID()}/files`, { headers: { Cookie: cookie } })
		expect(response.status).toBe(404)
	})

	it("rejects path traversal through the file name", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Traversal")
		expect((await upload(cookie, agentId)).status).toBe(201)
		const response = await app.request(`/api/agents/${agentId}/files/..%2Fa.md`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		})
		expect(response.status).toBe(400)
	})

	it("denies file operations to a member with only agents:read", async () => {
		const { cookie, userId } = await createAdminSession()
		const agentId = await createAgent(cookie, "Perm")
		const reader = await createReaderSession(userId)
		const response = await app.request(`/api/agents/${agentId}/files`, { headers: { Cookie: reader } })
		expect(response.status).toBe(403)
	})

	it("removes the upload directory when the agent is deleted", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Cleanup")
		expect((await upload(cookie, agentId)).status).toBe(201)
		expect((await stat(join(UPLOAD_ROOT, agentId))).isDirectory()).toBe(true)

		const deleted = await app.request(`/api/agents/${agentId}`, { method: "DELETE", headers: { Cookie: cookie } })
		expect(deleted.status).toBe(204)
		await expect(readdir(join(UPLOAD_ROOT, agentId))).rejects.toMatchObject({ code: "ENOENT" })
	})
})
