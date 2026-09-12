import { createHash, createHmac } from "node:crypto"

type BootstrapIdentity = {
	accessVersion: number
	bootstrapSecret: string
	embedId: string
	requestId: string
}

export const REQUEST_ID_BYTES = 16
export const BOOTSTRAP_SECRET_BYTES = 32

export function isCanonicalBase64Url(value: string, bytes: number): boolean {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) return false
	const decoded = Buffer.from(value, "base64url")
	return decoded.byteLength === bytes && decoded.toString("base64url") === value
}

export function hashSecret(secret: string): string {
	return createHash("sha256").update(secret).digest("base64url")
}

export function deriveSessionCredential(appSecret: string, identity: BootstrapIdentity): string {
	const key = createHmac("sha256", Buffer.from(appSecret, "base64url"))
		.update("talqo:conversation-bootstrap:v1")
		.digest()
	const fields = [identity.embedId, String(identity.accessVersion), identity.requestId, identity.bootstrapSecret]
	const encoded = fields.map((field) => `${Buffer.byteLength(field)}:${field}`).join("")
	return createHmac("sha256", key).update(encoded).digest("base64url")
}
