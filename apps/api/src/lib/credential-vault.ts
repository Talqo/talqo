import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

const ENVELOPE_VERSION = 1 as const
const NONCE_BYTES = 12
const KEY_BYTES = 32

export type CredentialEnvelope = {
	ciphertext: string
	nonce: string
	tag: string
	version: typeof ENVELOPE_VERSION
}

export type CredentialSecretMap = Record<string, CredentialEnvelope>

/** Envelopes are bound to both the module key context and the purpose they were sealed for. */
function associatedData(context: object): Buffer {
	return Buffer.from(JSON.stringify(context, Object.keys(context).toSorted()))
}

export function createCredentialVault(appSecret: string | undefined, keyContext: string) {
	if (!appSecret) {
		throw new Error(
			"APP_SECRET must be set before stored credentials can be used; generate one with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`",
		)
	}
	const sourceKey = Buffer.from(appSecret, "base64url")
	const key = Buffer.from(hkdfSync("sha256", sourceKey, Buffer.alloc(0), keyContext, KEY_BYTES))

	return {
		encrypt(payload: unknown, context: object): CredentialEnvelope {
			const nonce = randomBytes(NONCE_BYTES)
			const cipher = createCipheriv("aes-256-gcm", key, nonce)
			cipher.setAAD(associatedData(context))
			const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()])

			return {
				version: ENVELOPE_VERSION,
				nonce: nonce.toString("base64url"),
				ciphertext: ciphertext.toString("base64url"),
				tag: cipher.getAuthTag().toString("base64url"),
			}
		},
		/** `T` defaults to the string map every stored credential uses. */
		decrypt<T = Record<string, string>>(envelope: CredentialEnvelope, context: object): T {
			const open = (aad: Buffer): T => {
				const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64url"))
				decipher.setAAD(aad)
				decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"))
				const plaintext = Buffer.concat([
					decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
					decipher.final(),
				])
				return JSON.parse(plaintext.toString("utf8")) as T
			}
			try {
				return open(associatedData(context))
			} catch (error) {
				// Envelopes sealed before the vault moved to src/lib carried `version: 1` in their AAD,
				// which sorts last, so this is byte-identical to the old construction. They stay readable
				// with no migration; the first re-save seals them in the new form.
				try {
					return open(associatedData({ ...context, version: ENVELOPE_VERSION }))
				} catch {
					throw error
				}
			}
		},
	}
}
