import { describe, expect, it } from "bun:test"

import { createCredentialVault } from "./credential-vault.ts"

const APP_SECRET = Buffer.alloc(32, 9).toString("base64url")
const context = { configId: "singleton", providerId: "openai", role: "text" as const }

describe("credential vault", () => {
	it("round-trips credentials without storing plaintext", () => {
		const vault = createCredentialVault(APP_SECRET)
		const envelope = vault.encrypt({ apiKey: "sk-secret" }, context)

		expect(JSON.stringify(envelope)).not.toContain("sk-secret")
		expect(vault.decrypt(envelope, context)).toEqual({ apiKey: "sk-secret" })
	})

	it("rejects tampered ciphertext", () => {
		const vault = createCredentialVault(APP_SECRET)
		const envelope = vault.encrypt({ apiKey: "sk-secret" }, context)
		const ciphertext = Buffer.from(envelope.ciphertext, "base64url")
		ciphertext[0] = ciphertext[0]! ^ 1
		const tampered = { ...envelope, ciphertext: ciphertext.toString("base64url") }

		expect(() => vault.decrypt(tampered, context)).toThrow()
	})

	it("binds ciphertext to provider and role context", () => {
		const vault = createCredentialVault(APP_SECRET)
		const envelope = vault.encrypt({ apiKey: "sk-secret" }, context)

		expect(() => vault.decrypt(envelope, { ...context, role: "embedding" })).toThrow()
		expect(() => vault.decrypt(envelope, { ...context, providerId: "mistral" })).toThrow()
	})
})
