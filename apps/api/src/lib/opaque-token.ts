export function generateOpaqueToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
}

export function hashOpaqueToken(token: string): string {
	return new Bun.CryptoHasher("sha256").update(token).digest("hex")
}
