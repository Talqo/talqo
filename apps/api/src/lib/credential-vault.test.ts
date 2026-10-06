import { describe, expect, it } from "bun:test"

import { createCredentialVault } from "./credential-vault.ts"

const APP_SECRET = Buffer.alloc(32, 9).toString("base64url")
const AI_PROVIDER = "talqo:ai-provider-credentials:v1"
const MCP = "talqo:mcp-credentials:v1"
const context = { configId: "singleton", providerId: "openai", role: "text" as const }

describe("credential vault", () => {
	it("round-trips credentials without storing plaintext", () => {
		const vault = createCredentialVault(APP_SECRET, AI_PROVIDER)
		const envelope = vault.encrypt({ apiKey: "sk-secret" }, context)

		expect(JSON.stringify(envelope)).not.toContain("sk-secret")
		expect(vault.decrypt<Record<string, string>>(envelope, context)).toEqual({ apiKey: "sk-secret" })
	})

	it("rejects tampered ciphertext", () => {
		const vault = createCredentialVault(APP_SECRET, AI_PROVIDER)
		const envelope = vault.encrypt({ apiKey: "sk-secret" }, context)
		const ciphertext = Buffer.from(envelope.ciphertext, "base64url")
		ciphertext[0] = ciphertext[0]! ^ 1

		expect(() => vault.decrypt({ ...envelope, ciphertext: ciphertext.toString("base64url") }, context)).toThrow()
	})

	it("binds ciphertext to provider and role context", () => {
		const vault = createCredentialVault(APP_SECRET, AI_PROVIDER)
		const envelope = vault.encrypt({ apiKey: "sk-secret" }, context)

		expect(() => vault.decrypt(envelope, { ...context, role: "embedding" })).toThrow()
		expect(() => vault.decrypt(envelope, { ...context, providerId: "mistral" })).toThrow()
	})

	it("keeps one module's envelope unreadable under another module's key", () => {
		const envelope = createCredentialVault(APP_SECRET, MCP).encrypt({ apiKey: "sk-secret" }, context)

		expect(() => createCredentialVault(APP_SECRET, AI_PROVIDER).decrypt(envelope, context)).toThrow()
		expect(() => createCredentialVault(APP_SECRET, MCP).decrypt(envelope, { ...context, role: "embedding" })).toThrow()
	})

	it("round-trips a payload the string map type would reject", () => {
		const vault = createCredentialVault(APP_SECRET, MCP)
		const tokens = { access_token: "at", expires_in: 3600 }
		const envelope = vault.encrypt(tokens, { serverId: "s1" })

		expect(vault.decrypt<typeof tokens>(envelope, { serverId: "s1" })).toEqual(tokens)
	})
})
