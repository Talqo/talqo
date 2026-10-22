import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import os from "node:os"
import path from "node:path"
import { defineConfig, searchForWorkspaceRoot } from "vite"

const DEFAULT_API_PORT = 3000
const DEFAULT_WEB_PORT = 5173

export default defineConfig({
	plugins: [tanstackRouter({ autoCodeSplitting: true }), react(), tailwindcss()],
	build: {
		reportCompressedSize: false,
	},
	resolve: {
		alias: {
			"@": `${import.meta.dirname}/src`,
		},
	},
	server: {
		host: "0.0.0.0",
		port: Number(process.env.TALQO_WEB_PORT ?? DEFAULT_WEB_PORT),
		strictPort: true,
		fs: {
			// Vite serves only the workspace root by default; Bun's global store sits outside it.
			allow: [searchForWorkspaceRoot(import.meta.dirname), path.join(os.homedir(), ".bun/install/cache/links")],
		},
		// Proxying keeps /api same-origin so the SameSite=Lax session cookie is actually sent (no CORS needed).
		proxy: {
			"/api": `http://localhost:${process.env.TALQO_API_PORT ?? DEFAULT_API_PORT}`,
			"/health": `http://localhost:${process.env.TALQO_API_PORT ?? DEFAULT_API_PORT}`,
		},
	},
})
