const HTTP_PROTOCOLS = new Set(["http:", "https:"])

export function assertHttpBaseUrl(value: string, label = "Provider base URL"): URL {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error(`${label} must be a valid HTTP or HTTPS URL`)
	}
	if (!HTTP_PROTOCOLS.has(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS`)
	return url
}
