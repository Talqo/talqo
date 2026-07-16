import { app } from "./app.ts"

const port = 3000

const server = Bun.serve({ fetch: app.fetch, hostname: "0.0.0.0", port })

console.log(`API listening on http://localhost:${server.port}`)
