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
