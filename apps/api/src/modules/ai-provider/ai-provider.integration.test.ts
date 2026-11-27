import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as aiProviderSeed from "@/modules/ai-provider/ai-provider.seed.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { afterAll, beforeEach, describe, expect, it } from "bun:test"

import type { StoredEmbeddingConfiguration, StoredTextConfiguration } from "./ai-provider.types.ts"

async function adminCookie(): Promise<string> {
	const username = uniqueUsername()
	await roles.bootstrapAdmin({ username, password: DEFAULT_PASSWORD })
	return sessionCookie(username)
}

async function memberCookie(): Promise<string> {
	const username = uniqueUsername()
	await identity.createUser({ username, password: DEFAULT_PASSWORD })
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

const SEED_ENV_KEYS = [
	"TALQO_SEED_AI_BASE_URL",
	"TALQO_SEED_AI_API_KEY",
	"TALQO_SEED_TEXT_MODEL",
	"TALQO_SEED_EMBEDDING_MODEL",
] as const

function clearSeedEnvironment(): void {
	for (const key of SEED_ENV_KEYS) delete Bun.env[key]
}

describe("AI provider seed", () => {
	beforeEach(async () => {
		await sql`DELETE FROM ai_provider_config`
		clearSeedEnvironment()
	})

	afterAll(() => {
		clearSeedEnvironment()
	})

	it("skips seeding while no provider variables are configured", async () => {
		await aiProviderSeed.seed()

		const rows = await sql`SELECT id FROM ai_provider_config`
		expect(rows).toHaveLength(0)
	})

	it("rejects a partially configured provider environment", async () => {
		Bun.env.TALQO_SEED_AI_BASE_URL = "https://seed.example/v1"

		await expect(aiProviderSeed.seed()).rejects.toThrow(/incomplete/)
		expect(await sql`SELECT id FROM ai_provider_config`).toHaveLength(0)
	})

	it("seeds an OpenAI-compatible configuration with encrypted credentials", async () => {
		Bun.env.TALQO_SEED_AI_BASE_URL = "https://seed.example/v1"
		Bun.env.TALQO_SEED_AI_API_KEY = "seed-secret"
		Bun.env.TALQO_SEED_TEXT_MODEL = "seed-text-model"
		Bun.env.TALQO_SEED_EMBEDDING_MODEL = "seed-embedding-model"

		await aiProviderSeed.seed()

		const [row] = await sql<
			Array<{ embedding: StoredEmbeddingConfiguration; revision: number; text: StoredTextConfiguration }>
		>`SELECT revision, text_config AS text, embedding_config AS embedding FROM ai_provider_config`
		expect(row?.revision).toBe(1)
		expect(row?.text).toMatchObject({
			providerId: "openai-compatible",
			modelId: "seed-text-model",
			authMode: "static",
			settings: { baseURL: "https://seed.example/v1" },
		})
		expect(row?.text.credentials).not.toBeNull()
		expect(row?.embedding).toMatchObject({
			modelId: "seed-embedding-model",
			credentialSource: "text",
			credentials: null,
		})
		expect(JSON.stringify(row)).not.toContain("seed-secret")
	})
})
