const OPAQUE_TOKEN_BYTES = 32

export function generateOpaqueToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(OPAQUE_TOKEN_BYTES))).toString("base64url")
}

export function hashOpaqueToken(token: string): string {
	return new Bun.CryptoHasher("sha256").update(token).digest("hex")
}
