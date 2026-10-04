import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { beforeEach, describe, expect, it } from "bun:test"

async function adminCookie(): Promise<string> {
	const username = uniqueUsername()
	await roles.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	return sessionCookie(username)
}

async function memberCookie(): Promise<string> {
	const username = uniqueUsername()
	await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	return sessionCookie(username)
}

async function sessionCookie(username: string): Promise<string> {
	const response = await app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password: DEFAULT_PASSWORD }),
	})
	const cookie = response.headers.get("set-cookie")?.split(";")[0]
	if (!cookie) throw new Error("Expected session cookie")
	return cookie
}

const configuration = {
	expectedRevision: 0,
	text: {
		providerId: "openai",
		modelId: "gpt-5-mini",
		authMode: "static",
		settings: {},
		credentials: { apiKey: "sk-database-secret" },
	},
	embedding: {
		providerId: "openai",
		modelId: "text-embedding-3-small",
		authMode: "static",
		settings: {},
		credentialSource: "text",
	},
}

describe("AI provider configuration", () => {
	beforeEach(async () => {
		await sql`TRUNCATE TABLE ai_provider_config, permission_grant, invitation, session, "user" CASCADE`
	})

	it("denies a member without the AI provider permission", async () => {
		const cookie = await memberCookie()

		const response = await app.request("/api/ai-provider-configuration", { headers: { Cookie: cookie } })

		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ code: "permission-denied" })
	})

	it("stores encrypted credentials and returns only redacted state", async () => {
		const cookie = await adminCookie()

		const response = await app.request("/api/ai-provider-configuration", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(configuration),
		})

		expect(response.status).toBe(200)
		const bodyText = await response.text()
		expect(bodyText).not.toContain("sk-database-secret")
		expect(JSON.parse(bodyText)).toMatchObject({ revision: 1, health: "configured", text: { hasCredentials: true } })

		const [row] = await sql`SELECT text_config::text AS text FROM ai_provider_config`
		expect(String(row?.text)).not.toContain("sk-database-secret")
	})

	it("rejects stale updates without changing the stored revision", async () => {
		const cookie = await adminCookie()
		const request = () =>
			app.request("/api/ai-provider-configuration", {
				method: "PUT",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify(configuration),
			})

		expect((await request()).status).toBe(200)
		expect((await request()).status).toBe(409)

		const [row] = await sql`SELECT revision FROM ai_provider_config`
		expect(row?.revision).toBe(1)
	})

	it("rejects credentials sent with deployment-identity authentication", async () => {
		const cookie = await adminCookie()

		const response = await app.request("/api/ai-provider-configuration", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				expectedRevision: 0,
				text: {
					providerId: "azure",
					modelId: "gpt-5",
					authMode: "deployment-identity",
					settings: { baseURL: "https://example.openai.azure.com" },
					credentials: { apiKey: "sk-dropped" },
				},
				embedding: {
					providerId: "openai",
					modelId: "text-embedding-3-small",
					authMode: "static",
					settings: {},
					credentialSource: "text",
				},
			}),
		})

		expect(response.status).toBe(400)
		expect(await response.text()).not.toContain("sk-dropped")
	})
})
