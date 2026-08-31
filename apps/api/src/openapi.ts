import type { ProblemCode } from "./http/problem.ts"

import { app } from "./app.ts"
import { allProblemsOpenApiSchema, problemSchema } from "./http/problem.ts"

type ProblemResponseMetadata = {
	"x-problem-codes"?: string[]
	content?: { "application/problem+json"?: { schema?: unknown } }
}

export function createOpenApiDocument() {
	const document = app.getOpenAPI31Document({
		openapi: "3.1.1",
		info: {
			title: "Talqo API",
			version: "0.0.1",
		},
	})
	const schemas = document.components?.schemas
	if (!schemas) throw new Error("OpenAPI components are missing")
	schemas.ProblemDetails = allProblemsOpenApiSchema as (typeof schemas)[string]

	for (const pathItem of Object.values(document.paths ?? {})) {
		for (const operation of Object.values(pathItem)) {
			if (typeof operation !== "object" || operation === null || !("responses" in operation)) continue
			for (const responseValue of Object.values(operation.responses)) {
				const response = responseValue as ProblemResponseMetadata
				const codes = response["x-problem-codes"]
				const media = response.content?.["application/problem+json"]
				if (!codes || !media?.schema) continue
				media.schema = problemSchema(codes as ProblemCode[])
				delete response["x-problem-codes"]
			}
		}
	}
	return document
}

// Serialize the composed app's OpenAPI registry without starting a server.
if (import.meta.main) {
	const JSON_INDENT = 2
	const output = new URL("../openapi.json", import.meta.url)
	await Bun.write(output, `${JSON.stringify(createOpenApiDocument(), null, JSON_INDENT)}\n`)
}
