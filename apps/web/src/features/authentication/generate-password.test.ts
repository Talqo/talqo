import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"

import { generateRandomPassword } from "./generate-password"

function stubRandomBytes(bytes: number[]) {
	let draw = 0
	return spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
		if (!(array instanceof Uint8Array)) throw new Error("Expected a byte array")
		if (draw >= bytes.length) throw new Error("Unexpected random draw")
		array[0] = bytes[draw] ?? 0
		draw += 1
		return array
	})
}

afterEach(() => {
	mock.restore()
})

describe("generateRandomPassword", () => {
	test("generates exactly 24 characters across the allowed character classes", () => {
		stubRandomBytes([0, 1, 24, 25, 26, 27, 50, 51, 52, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 227])

		expect(generateRandomPassword()).toBe("ABYZabyz09!@#$%^&*()-_=+")
	})

	test("rejects bytes 228 through 255 to avoid modulo bias", () => {
		const random = stubRandomBytes([228, 1, 255, 2, ...Array.from({ length: 22 }, () => 0)])

		expect(generateRandomPassword()).toBe("BC" + "A".repeat(22))
		expect(random).toHaveBeenCalledTimes(26)
	})
})
