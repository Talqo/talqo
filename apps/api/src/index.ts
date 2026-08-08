import { app } from "./app.ts"
import { env } from "./config/env.ts"

const server = Bun.serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.TALQO_API_PORT })

console.log(`API listening on http://localhost:${server.port}`)
