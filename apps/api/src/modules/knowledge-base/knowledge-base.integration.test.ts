import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.service.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, giveRole, uniqueUsername } from "@/test-helpers.ts"
import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { readdir, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"

import * as repository from "./knowledge-base.repository.ts"
import { MAX_FILE_SIZE_BYTES, searchKnowledge } from "./knowledge-base.service.ts"

const LARGE_UPLOAD_BYTES = 300_000

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

async function createReaderSession(): Promise<string> {
	const username = uniqueUsername()
	const member = await identity.createUser({ username, password: DEFAULT_PASSWORD })
	await giveRole(member.id, ["agents:read"])
	return login(username)
}

async function createAgent(cookie: string, name: string): Promise<string> {
	const response = await app.request("/api/agents", {
		method: "POST",
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		body: JSON.stringify({ name, systemPrompt: "Prompt", wordBlacklist: [] }),
	})
	expect(response.status).toBe(201)
	const { agent: created } = (await response.json()) as { agent: { id: string } }
	return created.id
}

function upload(cookie: string, agentId: string, name = "a.md", contents = "hello") {
	const form = new FormData()
	form.append("file", new File([contents], name, { type: "text/markdown" }))
	return app.request(`/api/agents/${agentId}/files`, { method: "POST", headers: { Cookie: cookie }, body: form })
}

async function expectProblem(response: Response, status: number, code: string) {
	expect(response.status).toBe(status)
	expect(response.headers.get("Content-Type")).toBe("application/problem+json")
	expect(await response.json()).toEqual({ code, type: `https://docs.talqo.chat/problems#${code}` })
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE blacklist_word, agent, permission_grant, invitation, session, "user" CASCADE`
	await rm(UPLOAD_ROOT, { force: true, recursive: true })
})

afterAll(async () => {
	await rm(UPLOAD_ROOT, { force: true, recursive: true })
})

async function createOwner(name: string) {
	return agent.createAgent({ name: `${name} ${crypto.randomUUID()}`, systemPrompt: "Answer", wordBlacklist: [] })
}

describe("knowledge embeddings", () => {
	it("retains failed state and refuses to reclaim it without a retry", async () => {
		const claimKey = `test-fail-${crypto.randomUUID()}`
		const owner = await createOwner("Knowledge")
		try {
			await repository.enqueue(owner.id, "guide.md")
			const first = await repository.claim(claimKey)
			expect(first?.name).toBe("guide.md")
			if (!first) throw new Error("Expected an ingestion job")
			await repository.fail(first, "provider-error")
			await repository.reindexChanged(claimKey)
			expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("failed")
			expect(await repository.claim(claimKey)).toBeUndefined()
		} finally {
			await agent.deleteAgent(owner.id)
		}
	})

	it("retries a failed file and stores its vectors atomically", async () => {
		const claimKey = `test-retry-${crypto.randomUUID()}`
		const owner = await createOwner("Knowledge")
		try {
			await repository.enqueue(owner.id, "guide.md")
			const first = await repository.claim(claimKey)
			if (!first) throw new Error("Expected an ingestion job")
			await repository.fail(first, "provider-error")
			await repository.retry(owner.id, "guide.md")
			const retried = await repository.claim(claimKey)
			if (!retried) throw new Error("Expected a retried job")
			await repository.complete(retried, claimKey, [{ text: "First section", embedding: [0.1, 0.2, 0.3] }])
			const chunks = await sql<{ text: string; embedding: string }[]>`
				SELECT c.text, c.embedding::text AS embedding FROM agent_file_chunk c
				JOIN agent_file f ON f.id = c.file_id WHERE f.agent_id = ${owner.id}`
			expect(chunks.map(({ text, embedding }) => ({ text, embedding }))).toEqual([
				{ text: "First section", embedding: "[0.1,0.2,0.3]" },
			])
		} finally {
			await agent.deleteAgent(owner.id)
		}
	})

	it("requeues files when the embedding model changes and fences the stale completion", async () => {
		const firstKey = `test-model-a-${crypto.randomUUID()}`
		const secondKey = `test-model-b-${crypto.randomUUID()}`
		const owner = await createOwner("Knowledge")
		try {
			await repository.enqueue(owner.id, "guide.md")
			const first = await repository.claim(firstKey)
			if (!first) throw new Error("Expected an ingestion job")
			await repository.complete(first, firstKey, [{ text: "First section", embedding: [0.1, 0.2, 0.3] }])
			await repository.reindexChanged(secondKey)
			expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("pending")
			const changed = await repository.claim(secondKey)
			if (!changed) throw new Error("Expected a model-change job")
			await repository.complete(first, firstKey, [{ text: "Stale", embedding: [1, 2, 3] }])
			expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("processing")
			await repository.complete(changed, secondKey, [{ text: "New", embedding: [3, 2, 1] }])
			expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("ready")
		} finally {
			await agent.deleteAgent(owner.id)
		}
	})

	it("recovers processing files after a restart and fences the stale worker", async () => {
		const claimKey = `test-recover-${crypto.randomUUID()}`
		const owner = await createOwner("Knowledge")
		try {
			await repository.enqueue(owner.id, "guide.md")
			const interrupted = await repository.claim(claimKey)
			if (!interrupted) throw new Error("Expected a job before restart")
			await repository.recover()
			const recovered = await repository.claim(claimKey)
			if (!recovered) throw new Error("Expected a recovered job")
			await repository.complete(interrupted, claimKey, [{ text: "Old worker", embedding: [9, 9, 9] }])
			expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("processing")
			await repository.complete(recovered, claimKey, [{ text: "Recovered", embedding: [4, 5, 6] }])
			expect((await repository.statuses(owner.id)).get("guide.md")?.status).toBe("ready")
		} finally {
			await agent.deleteAgent(owner.id)
		}
	})

	it("searches ready chunks by similarity within the agent and model key", async () => {
		const owner = await createOwner("Search")
		const other = await createOwner("Search")
		try {
			await repository.enqueue(owner.id, "guide.md")
			const job = await repository.claim("key-a")
			if (!job) throw new Error("Expected an ingestion job")
			await repository.complete(job, "key-a", [
				{ text: "apples", embedding: [1, 0, 0] },
				{ text: "bananas", embedding: [0, 1, 0] },
			])
			await repository.enqueue(other.id, "other.md")
			const otherJob = await repository.claim("key-a")
			if (!otherJob) throw new Error("Expected another ingestion job")
			await repository.complete(otherJob, "key-a", [{ text: "other agent", embedding: [1, 0, 0] }])
			expect(await repository.search(owner.id, [1, 0, 0], "key-a", 5)).toEqual(["apples", "bananas"])
			expect(await repository.search(owner.id, [1, 0, 0], "key-a", 1)).toEqual(["apples"])
			expect(await repository.search(owner.id, [1, 0, 0], "key-b", 5)).toEqual([])
		} finally {
			await agent.deleteAgent(owner.id)
			await agent.deleteAgent(other.id)
		}
	})

	it("skips the embedding provider when the agent has no ready files", async () => {
		const owner = await createOwner("Empty")
		const prepare = spyOn(aiProvider, "prepareEmbeddingOperation")
		try {
			await repository.enqueue(owner.id, "pending.md")
			expect(await searchKnowledge(owner.id, "question")).toEqual([])
			expect(prepare).not.toHaveBeenCalled()
		} finally {
			prepare.mockRestore()
			await agent.deleteAgent(owner.id)
		}
	})
})

describe("agent knowledge files", () => {
	it("exposes pending ingestion and lets an operator retry only failed files", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Retry files")
		const uploaded = await upload(cookie, agentId)
		expect(uploaded.status).toBe(201)
		expect(((await uploaded.json()) as { file: { embeddingStatus: string } }).file.embeddingStatus).toBe("pending")
		const retryUrl = `/api/agents/${agentId}/files/a.md/retry`
		await expectProblem(
			await app.request(retryUrl, { method: "POST", headers: { Cookie: cookie } }),
			409,
			"agent-file-not-retryable",
		)
		await sql`UPDATE agent_file SET status = 'failed', error = 'provider-error' WHERE agent_id = ${agentId}`
		const listed = await app.request(`/api/agents/${agentId}/files`, { headers: { Cookie: cookie } })
		expect(
			((await listed.json()) as { files: { embeddingStatus: string; embeddingError: string | null }[] }).files[0],
		).toMatchObject({
			embeddingStatus: "failed",
			embeddingError: "provider-error",
		})
		expect((await app.request(retryUrl, { method: "POST", headers: { Cookie: cookie } })).status).toBe(204)
		const queued = await app.request(`/api/agents/${agentId}/files`, { headers: { Cookie: cookie } })
		expect(((await queued.json()) as { files: { embeddingStatus: string }[] }).files[0]?.embeddingStatus).toBe(
			"pending",
		)
	})

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
		expect(
			((await sql`SELECT name FROM agent_file WHERE agent_id = ${agentId}`) as { name: string }[]).map(
				({ name }) => name,
			),
		).toEqual(["renamed.md"])

		const removed = await app.request(`/api/agents/${agentId}/files/renamed.md`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		})
		expect(removed.status).toBe(204)
		const after = await app.request(`/api/agents/${agentId}/files`, { headers: { Cookie: cookie } })
		expect(((await after.json()) as { files: unknown[] }).files).toEqual([])
		expect((await sql`SELECT id FROM agent_file WHERE agent_id = ${agentId}`).length).toBe(0)
	})

	it("downloads a file with its raw bytes and attachment headers", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Download")
		expect((await upload(cookie, agentId)).status).toBe(201)

		const response = await app.request(`/api/agents/${agentId}/files/a.md`, { headers: { Cookie: cookie } })
		expect(response.status).toBe(200)
		expect(await response.text()).toBe("hello")
		expect(response.headers.get("content-type")).toBe("application/octet-stream")
		const disposition = response.headers.get("content-disposition")
		expect(disposition).toContain("attachment")
		expect(disposition).toContain(`filename="a.md"`)
		expect(disposition).toContain("filename*=UTF-8''a.md")
	})

	it("percent-encodes special characters in the download file name", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Encoding")
		const name = "přehled #1.md"
		const form = new FormData()
		form.append("file", new File(["x"], name, { type: "text/markdown" }))
		const uploaded = await app.request(`/api/agents/${agentId}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: form,
		})
		expect(uploaded.status).toBe(201)

		const response = await app.request(`/api/agents/${agentId}/files/${encodeURIComponent(name)}`, {
			headers: { Cookie: cookie },
		})
		expect(response.status).toBe(200)
		const disposition = response.headers.get("content-disposition")
		expect(disposition).toContain(`filename="p_ehled #1.md"`)
		expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`)
	})

	it("returns 404 when downloading an unknown file", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Missing")
		const response = await app.request(`/api/agents/${agentId}/files/missing.md`, { headers: { Cookie: cookie } })
		await expectProblem(response, 404, "agent-file-not-found")
	})

	it("rejects path traversal through the download file name", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "GetTraversal")
		expect((await upload(cookie, agentId)).status).toBe(201)
		const response = await app.request(`/api/agents/${agentId}/files/..%2Fa.md`, { headers: { Cookie: cookie } })
		await expectProblem(response, 400, "agent-file-invalid")
	})

	it("rejects a duplicate file name with 409", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Dupes")
		expect((await upload(cookie, agentId)).status).toBe(201)
		await expectProblem(await upload(cookie, agentId), 409, "agent-file-name-taken")
	})

	it("rejects an oversized file with 413 over HTTP", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Oversize")
		const form = new FormData()
		form.append("file", new File([new Uint8Array(MAX_FILE_SIZE_BYTES + 1)], "big.pdf", { type: "application/pdf" }))
		const response = await app.request(`/api/agents/${agentId}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: form,
		})
		await expectProblem(response, 413, "payload-too-large")
	})

	it("accepts a file larger than the JSON body limit", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Large upload")

		const uploaded = await upload(cookie, agentId, "large.md", "x".repeat(LARGE_UPLOAD_BYTES))
		expect(uploaded.status).toBe(201)
		expect(((await uploaded.json()) as { file: { sizeBytes: number } }).file.sizeBytes).toBe(LARGE_UPLOAD_BYTES)
	})

	it("returns 404 when the agent does not exist", async () => {
		const { cookie } = await createAdminSession()
		const response = await app.request(`/api/agents/${crypto.randomUUID()}/files`, { headers: { Cookie: cookie } })
		await expectProblem(response, 404, "agent-not-found")
	})

	it("lets a member with only agents:read list and download files", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Perm")
		expect((await upload(cookie, agentId)).status).toBe(201)
		const reader = await createReaderSession()

		const listed = await app.request(`/api/agents/${agentId}/files`, { headers: { Cookie: reader } })
		const downloaded = await app.request(`/api/agents/${agentId}/files/a.md`, { headers: { Cookie: reader } })

		expect(listed.status).toBe(200)
		expect(downloaded.status).toBe(200)
		expect(await downloaded.text()).toBe("hello")
	})

	it("denies file changes to a member with only agents:read", async () => {
		const { cookie } = await createAdminSession()
		const agentId = await createAgent(cookie, "Perm")
		const reader = await createReaderSession()

		await expectProblem(await upload(reader, agentId), 403, "permission-denied")
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
