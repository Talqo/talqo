import { describe, expect, it } from "bun:test"
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto"

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

	it("binds ciphertext to provider and role context", () => {
		const vault = createCredentialVault(APP_SECRET, AI_PROVIDER)
		const envelope = vault.encrypt({ apiKey: "sk-secret" }, context)

		expect(() => vault.decrypt(envelope, { ...context, role: "embedding" })).toThrow()
		expect(() => vault.decrypt(envelope, { ...context, providerId: "mistral" })).toThrow()
	})

	it("keeps one module's envelope unreadable under another module's key", () => {
		const envelope = createCredentialVault(APP_SECRET, MCP).encrypt({ apiKey: "sk-secret" }, context)

		expect(() => createCredentialVault(APP_SECRET, AI_PROVIDER).decrypt(envelope, context)).toThrow()
	})

	it("still opens envelopes sealed with the pre-move AAD", () => {
		// The old vault built its AAD as JSON.stringify({configId, providerId, role, version: 1});
		// sealed by hand here so the test does not depend on the code it guards.
		const key = Buffer.from(hkdfSync("sha256", Buffer.from(APP_SECRET, "base64url"), Buffer.alloc(0), AI_PROVIDER, 32))
		const nonce = randomBytes(12)
		const cipher = createCipheriv("aes-256-gcm", key, nonce)
		cipher.setAAD(Buffer.from(JSON.stringify({ ...context, version: 1 })))
		const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ apiKey: "sk-legacy" }), "utf8"), cipher.final()])
		const legacy = {
			version: 1 as const,
			nonce: nonce.toString("base64url"),
			ciphertext: ciphertext.toString("base64url"),
			tag: cipher.getAuthTag().toString("base64url"),
		}

		expect(createCredentialVault(APP_SECRET, AI_PROVIDER).decrypt<Record<string, string>>(legacy, context)).toEqual({
			apiKey: "sk-legacy",
		})
	})
})
