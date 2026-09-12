import ipaddr from "ipaddr.js"
import { createHmac } from "node:crypto"

const IPV6_BIT_LENGTH = 128
const BITS_PER_BYTE = 8
const HIGHEST_BIT_INDEX = 7

function parseAddress(value: string): ipaddr.IPv4 | ipaddr.IPv6 {
	const address = ipaddr.parse(value.trim())
	return address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress() ? address.toIPv4Address() : address
}

function trusted(address: ipaddr.IPv4 | ipaddr.IPv6, cidrs: readonly string[]): boolean {
	return cidrs.some((cidr) => {
		const [range, prefix] = ipaddr.parseCIDR(cidr)
		return address.kind() === range.kind() && address.match(range, prefix)
	})
}

function network(address: ipaddr.IPv4 | ipaddr.IPv6, ipv6Prefix: number): string {
	if (address.kind() === "ipv4") return `${address.toString()}/32`
	const bytes = address.toByteArray()
	for (let bit = ipv6Prefix; bit < IPV6_BIT_LENGTH; bit += 1) {
		const byte = Math.floor(bit / BITS_PER_BYTE)
		bytes[byte] = (bytes[byte] ?? 0) & ~(1 << (HIGHEST_BIT_INDEX - (bit % BITS_PER_BYTE)))
	}
	return `${ipaddr.fromByteArray(bytes).toString()}/${ipv6Prefix}`
}

export function resolveClientNetwork(
	peerAddress: string | undefined,
	forwardedFor: string | undefined,
	trustedProxyCidrs: readonly string[],
	ipv6Prefix: number,
): string | null {
	if (!peerAddress) return null
	try {
		let address = parseAddress(peerAddress)
		if (forwardedFor && trusted(address, trustedProxyCidrs)) {
			const chain = forwardedFor.split(",").map(parseAddress)
			for (let index = chain.length - 1; index >= 0; index -= 1) {
				if (!trusted(address, trustedProxyCidrs)) break
				const next = chain[index]
				if (!next) return null
				address = next
			}
		}
		return network(address, ipv6Prefix)
	} catch {
		return null
	}
}

export function hashClientNetwork(normalizedNetwork: string, appSecret: string): string {
	const key = createHmac("sha256", Buffer.from(appSecret, "base64url")).update("talqo:chat-network:v1").digest()
	return createHmac("sha256", key).update(normalizedNetwork).digest("base64url")
}
