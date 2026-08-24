import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

import type { AiProviderRole } from "./ai-provider.registry.ts"

const ENVELOPE_VERSION = 1 as const
const NONCE_BYTES = 12
const KEY_BYTES = 32
const KEY_CONTEXT = "talqo:ai-provider-credentials:v1"

export type CredentialEnvelope = {
	ciphertext: string
	nonce: string
	tag: string
	version: typeof ENVELOPE_VERSION
}

type CredentialContext = {
	configId: string
	providerId: string
	role: AiProviderRole
}

function associatedData(context: CredentialContext): Buffer {
	return Buffer.from(
		JSON.stringify({
			configId: context.configId,
			providerId: context.providerId,
			role: context.role,
			version: ENVELOPE_VERSION,
		}),
	)
}

export function createCredentialVault(appSecret: string | undefined) {
	if (!appSecret) {
		throw new Error(
			"APP_SECRET must be set before AI provider credentials can be used; generate one with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`",
		)
	}
	const sourceKey = Buffer.from(appSecret, "base64url")
	const key = Buffer.from(hkdfSync("sha256", sourceKey, Buffer.alloc(0), KEY_CONTEXT, KEY_BYTES))

	return {
		encrypt(credentials: Record<string, string>, context: CredentialContext): CredentialEnvelope {
			const nonce = randomBytes(NONCE_BYTES)
			const cipher = createCipheriv("aes-256-gcm", key, nonce)
			cipher.setAAD(associatedData(context))
			const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()])

			return {
				version: ENVELOPE_VERSION,
				nonce: nonce.toString("base64url"),
				ciphertext: ciphertext.toString("base64url"),
				tag: cipher.getAuthTag().toString("base64url"),
			}
		},
		decrypt(envelope: CredentialEnvelope, context: CredentialContext): Record<string, string> {
			const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64url"))
			decipher.setAAD(associatedData(context))
			decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"))
			const plaintext = Buffer.concat([
				decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
				decipher.final(),
			])
			const value: unknown = JSON.parse(plaintext.toString("utf8"))
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid credential payload")
			for (const credential of Object.values(value)) {
				if (typeof credential !== "string") throw new Error("Invalid credential payload")
			}
			return value as Record<string, string>
		},
	}
}
