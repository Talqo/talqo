import { describe, expect, it } from "bun:test"

import { hashClientNetwork, resolveClientNetwork } from "./client-network.ts"

const SECRET = Buffer.alloc(32, 9).toString("base64url")

describe("client network resolution", () => {
	it("normalizes IPv4, mapped IPv6, and native IPv6 prefixes", () => {
		expect(resolveClientNetwork("192.0.2.4", undefined, [], 64)).toBe("192.0.2.4/32")
		expect(resolveClientNetwork("::ffff:192.0.2.4", undefined, [], 64)).toBe("192.0.2.4/32")
		expect(resolveClientNetwork("2001:0db8:1234:5678::99", undefined, [], 64)).toBe("2001:db8:1234:5678::/64")
		expect(resolveClientNetwork("2001:db8:1234:5678::99", undefined, [], 128)).toBe("2001:db8:1234:5678::99/128")
	})

	it("ignores forwarding from untrusted peers and walks trusted chains from the right", () => {
		expect(resolveClientNetwork("198.51.100.9", "203.0.113.8", ["10.0.0.0/8"], 64)).toBe("198.51.100.9/32")
		expect(resolveClientNetwork("10.0.0.4", "203.0.113.8, 10.0.0.3", ["10.0.0.0/8"], 64)).toBe("203.0.113.8/32")
	})

	it("rejects an unusable peer or malformed trusted chain", () => {
		expect(resolveClientNetwork(undefined, undefined, [], 64)).toBeNull()
		expect(resolveClientNetwork("10.0.0.4", "bad", ["10.0.0.0/8"], 64)).toBeNull()
	})

	it("uses a stable purpose-keyed network hash", () => {
		const first = hashClientNetwork("192.0.2.4/32", SECRET)
		expect(first).toBe(hashClientNetwork("192.0.2.4/32", SECRET))
		expect(first).not.toContain("192.0.2.4")
		expect(first).not.toBe(hashClientNetwork("192.0.2.5/32", SECRET))
	})
})
