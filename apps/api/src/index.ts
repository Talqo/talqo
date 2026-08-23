import { app } from "./app.ts"
import { parseEnv } from "./config/env.ts"

// Validate the full environment before accepting traffic: misconfiguration
// must fail the process at boot, not during the first request.
const config = parseEnv(process.env)

const server = Bun.serve({ fetch: app.fetch, hostname: "0.0.0.0", port: config.TALQO_API_PORT })

console.log(`API listening on http://localhost:${server.port}`)
