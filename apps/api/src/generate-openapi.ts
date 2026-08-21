const JSON_INDENT = 2

const { createOpenApiDocument } = await import("./openapi.ts")

const output = new URL("../openapi.json", import.meta.url)
await Bun.write(output, `${JSON.stringify(createOpenApiDocument(), null, JSON_INDENT)}\n`)
