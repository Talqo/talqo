const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+"
const GENERATED_PASSWORD_LENGTH = 24
const BYTE_RANGE = 256

// Rejects bytes past the largest multiple of CHARSET.length, avoiding modulo bias.
function randomCharsetIndex(): number {
	const acceptLimit = BYTE_RANGE - (BYTE_RANGE % CHARSET.length)
	let byte: number
	do {
		const [drawn = 0] = crypto.getRandomValues(new Uint8Array(1))
		byte = drawn
	} while (byte >= acceptLimit)
	return byte % CHARSET.length
}

// Copy-pasted, never hand-typed: full entropy over readability.
export function generateRandomPassword(): string {
	return Array.from({ length: GENERATED_PASSWORD_LENGTH }, () => CHARSET[randomCharsetIndex()]).join("")
}
