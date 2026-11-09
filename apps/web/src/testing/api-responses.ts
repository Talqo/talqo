export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

export function parseJsonBody(body: BodyInit | null | undefined): unknown {
	if (typeof body !== "string") throw new Error("Expected a JSON request body")
	return JSON.parse(body)
}

export function problem(code: string, status: number): Response {
	return json({ code, type: `https://docs.talqo.chat/problems#${code}` }, status)
}

export function requestCount(
	requests: ReadonlyArray<{ method?: string; url: string }>,
	url: string,
	method = "GET",
): number {
	return requests.filter((request) => request.url === url && (request.method ?? "GET") === method).length
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input
	if (input instanceof URL) return input.href
	return input.url
}

export type RecordedRequest = {
	url: string
	method: string
	body: unknown
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit): RecordedRequest {
	const method = init?.method ?? "GET"
	return { url: requestUrl(input), method, body: init?.body ? parseJsonBody(init.body) : undefined }
}

export function recordRequest(
	requests: RecordedRequest[],
	input: RequestInfo | URL,
	init?: RequestInit,
): RecordedRequest {
	const request = requestDetails(input, init)
	requests.push(request)
	return request
}
