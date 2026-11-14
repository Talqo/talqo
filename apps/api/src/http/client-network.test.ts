import { env } from "@/config/env.ts"
import { describe, expect, it } from "bun:test"

import { hashClientNetwork, requestClientNetwork, resolveClientNetwork } from "./client-network.ts"

const SECRET = Buffer.alloc(32, 9).toString("base64url")

function forwardedHeader(name: string) {
	return name === "x-forwarded-for" ? "203.0.113.8" : undefined
}

describe("client network resolution", () => {
	it("rejects malformed trusted forwarding metadata instead of treating the network as unavailable", () => {
		const descriptor = Object.getOwnPropertyDescriptor(env, "TALQO_TRUSTED_PROXY_CIDRS")
		if (!descriptor) throw new Error("Expected the trusted proxy configuration")
		Object.defineProperty(env, "TALQO_TRUSTED_PROXY_CIDRS", { ...descriptor, get: () => ["10.0.0.0/8"] })
		try {
			expect(() =>
				requestClientNetwork({ env: { peerAddress: "10.0.0.1" }, req: { header: () => "garbage, 203.0.113.1" } }),
			).toThrow("invalid-request")
			expect(requestClientNetwork({ env: { peerAddress: "198.51.100.1" }, req: { header: () => "garbage" } })).toBe(
				"198.51.100.1/32",
			)
			expect(requestClientNetwork({ req: { header: () => undefined } })).toBeNull()
			expect(requestClientNetwork({ env: null, req: { header: () => undefined } })).toBeNull()
			expect(() =>
				requestClientNetwork({ env: { peerAddress: "not-an-ip" }, req: { header: () => undefined } }),
			).toThrow("invalid-request")
		} finally {
			Object.defineProperty(env, "TALQO_TRUSTED_PROXY_CIDRS", descriptor)
		}
	})

	it("reads forwarding metadata by header name", () => {
		const descriptor = Object.getOwnPropertyDescriptor(env, "TALQO_TRUSTED_PROXY_CIDRS")
		if (!descriptor) throw new Error("Expected the trusted proxy configuration")
		Object.defineProperty(env, "TALQO_TRUSTED_PROXY_CIDRS", { ...descriptor, get: () => ["10.0.0.0/8"] })
		try {
			expect(requestClientNetwork({ env: { peerAddress: "10.0.0.4" }, req: { header: forwardedHeader } })).toBe(
				"203.0.113.8/32",
			)
		} finally {
			Object.defineProperty(env, "TALQO_TRUSTED_PROXY_CIDRS", descriptor)
		}
	})

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

	it("stops walking the chain at the first untrusted hop", () => {
		expect(resolveClientNetwork("10.0.0.4", "10.0.0.2, 203.0.113.8", ["10.0.0.0/8"], 64)).toBe("203.0.113.8/32")
	})

	it("trusts a peer that matches any configured proxy range", () => {
		expect(resolveClientNetwork("10.0.0.4", "203.0.113.8", ["192.168.0.0/16", "10.0.0.0/8"], 64)).toBe("203.0.113.8/32")
		expect(resolveClientNetwork("10.0.0.4", "203.0.113.8", ["192.168.0.0/16"], 64)).toBe("10.0.0.4/32")
	})

	it("does not treat a CIDR of another address family as a trusted match", () => {
		expect(resolveClientNetwork("192.0.2.4", "203.0.113.8", ["::/0"], 64)).toBe("192.0.2.4/32")
	})

	it("rejects an unusable peer or malformed trusted chain", () => {
		expect(resolveClientNetwork(undefined, undefined, [], 64)).toBeNull()
		expect(resolveClientNetwork("10.0.0.4", "bad", ["10.0.0.0/8"], 64)).toBeNull()
	})

	it("uses a stable purpose-keyed network hash", () => {
		expect(hashClientNetwork("192.0.2.4/32", SECRET)).toBe("wUAi-2M-s743jm8Mj6zTo7L3J9r2A4tuX8icEIbNhlU")
	})

	it("keeps the network hash deterministic and network-specific", () => {
		const first = hashClientNetwork("192.0.2.4/32", SECRET)
		expect(first).toBe(hashClientNetwork("192.0.2.4/32", SECRET))
		expect(first).not.toContain("192.0.2.4")
		expect(first).not.toBe(hashClientNetwork("192.0.2.5/32", SECRET))
	})
})
