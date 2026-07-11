import { serve } from "@hono/node-server"

import { app } from "./app.ts"

const port = 3000

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, ({ port: listeningPort }) => {
	console.log(`API listening on http://localhost:${listeningPort}`)
})
