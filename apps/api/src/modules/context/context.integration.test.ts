import { app } from "@/app.ts"
import { env } from "@/config/env.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { describe, expect, it } from "bun:test"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { BYTES_PER_MB, MAX_FILE_SIZE_MB } from "./context.service.ts"

type FileBody = {
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

async function createContext(cookie: string): Promise<string> {
	const response = await app.request("/api/context", { method: "POST", headers: { Cookie: cookie } })
	expect(response.status).toBe(201)
	const { contextId } = (await response.json()) as { contextId: string }
	return contextId
}

function uploadForm(content: string, filename = "context.txt"): FormData {
	const form = new FormData()
	form.append("file", new File([content], filename, { type: "text/plain" }))
	return form
}

describe("context", () => {
	it("creates a context, uploads, lists, renames, and deletes a file on disk", async () => {
		const { cookie } = await createAndLogin()
		const contextId = await createContext(cookie)

		const uploadResponse = await app.request(`/api/context/${contextId}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("Refund policy: 30 days."),
		})
		expect(uploadResponse.status).toBe(201)
		const { file } = (await uploadResponse.json()) as { file: FileBody }
		expect(file).toMatchObject({ name: "context.txt" })
		expect(file.sizeBytes).toBeGreaterThan(0)

		// The directory layout is the future per-agent shape: <uploadDir>/<contextId>/<name>.
		const stored = await readdir(join(env.TALQO_UPLOAD_DIR, contextId))
		expect(stored).toEqual(["context.txt"])

		const listResponse = await app.request(`/api/context/${contextId}/files`, { headers: { Cookie: cookie } })
		const { files } = (await listResponse.json()) as { files: FileBody[] }
		expect(files.map((f) => f.name)).toEqual(["context.txt"])

		const renameResponse = await app.request(`/api/context/${contextId}/files/${file.name}`, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Refund Policy" }),
		})
		expect(renameResponse.status).toBe(200)
		const { file: renamed } = (await renameResponse.json()) as { file: FileBody }
		expect(renamed.name).toBe("Refund Policy.txt")
		expect(renamed.sizeBytes).toBe(file.sizeBytes)

		const deleteResponse = await app.request(`/api/context/${contextId}/files/${renamed.name}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		})
		expect(deleteResponse.status).toBe(204)

		const emptyResponse = await app.request(`/api/context/${contextId}/files`, { headers: { Cookie: cookie } })
		const { files: remaining } = (await emptyResponse.json()) as { files: FileBody[] }
		expect(remaining).toEqual([])
	})

	it("rejects unknown context ids on every route", async () => {
		const { cookie } = await createAndLogin()
		const unknown = crypto.randomUUID()

		const attempts = [
			["GET", `/api/context/${unknown}/files`, undefined],
			["PATCH", `/api/context/${unknown}/files/context.txt`, JSON.stringify({ name: "x.txt" })],
			["DELETE", `/api/context/${unknown}/files/context.txt`, undefined],
		] as const
		const responses = await Promise.all(
			attempts.map(([method, path, body]) =>
				app.request(path, {
					method,
					headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
					body,
				}),
			),
		)
		for (const response of responses) {
			expect(response.status).toBe(404)
		}
	})

	it("rejects duplicate file names in one context", async () => {
		const { cookie } = await createAndLogin()
		const contextId = await createContext(cookie)

		const first = await app.request(`/api/context/${contextId}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("first"),
		})
		expect(first.status).toBe(201)

		const second = await app.request(`/api/context/${contextId}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("second"),
		})
		expect(second.status).toBe(409)
	})

	it("rejects URL-encoded path traversal in file names", async () => {
		const { cookie } = await createAndLogin()
		const contextId = await createContext(cookie)

		// Guard: a file outside the context dir must survive traversal attempts.
		await mkdir(env.TALQO_UPLOAD_DIR, { recursive: true })
		const guardPath = join(env.TALQO_UPLOAD_DIR, "guard.txt")
		await writeFile(guardPath, "must survive")

		const encoded = encodeURIComponent("../../guard.txt")
		const [uploadResp, deleteResp, renameResp] = await Promise.all([
			app.request(`/api/context/${contextId}/files`, {
				method: "POST",
				headers: { Cookie: cookie },
				body: uploadForm("payload", "../escape.txt"),
			}),
			app.request(`/api/context/${contextId}/files/${encoded}`, { method: "DELETE", headers: { Cookie: cookie } }),
			app.request(`/api/context/${contextId}/files/${encoded}`, {
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ name: "renamed.txt" }),
			}),
		])
		expect(uploadResp.status).toBe(400)
		expect(deleteResp.status).toBe(400)
		expect(renameResp.status).toBe(400)

		// Defense-in-depth: even though 400 was returned, verify nothing outside the dir was touched.
		expect(await readFile(guardPath, "utf8")).toBe("must survive")
	})

	it("rejects files over the size limit", async () => {
		const { cookie } = await createAndLogin()
		const contextId = await createContext(cookie)

		// One byte over the configured limit rejects without allocating a large binary blob.
		const tooBig = await app.request(`/api/context/${contextId}/files`, {
			method: "POST",
			headers: { Cookie: cookie },
			body: uploadForm("x".repeat(MAX_FILE_SIZE_MB * BYTES_PER_MB + 1)),
		})
		expect(tooBig.status).toBe(400)
	})
})
