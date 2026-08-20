import { resolve } from "node:path"

const JSON_INDENT = 2

process.env.DATABASE_URL = "postgres://openapi:openapi@localhost:5432/openapi"
process.env.NODE_ENV = "test"

const { createOpenApiDocument } = await import("./openapi.ts")

const output = process.env.OPENAPI_OUTPUT
	? resolve(process.env.OPENAPI_OUTPUT)
	: new URL("../openapi.json", import.meta.url)
await Bun.write(output, `${JSON.stringify(createOpenApiDocument(), null, JSON_INDENT)}\n`)
