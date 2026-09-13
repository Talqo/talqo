import { app } from "./app.ts"

export function createOpenApiDocument() {
	return app.getOpenAPI31Document({
		openapi: "3.1.1",
		info: {
			title: "Talqo API",
			version: "0.0.1",
		},
	})
}

// Serialize the composed app's OpenAPI registry without starting a server.
if (import.meta.main) {
	const JSON_INDENT = 2
	const output = new URL("../openapi.json", import.meta.url)
	await Bun.write(output, `${JSON.stringify(createOpenApiDocument(), null, JSON_INDENT)}\n`)
}
