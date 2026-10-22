import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { createRequire } from "node:module"
import path from "node:path"
import { defineConfig, searchForWorkspaceRoot } from "vite"

const DEFAULT_API_PORT = 3000
const DEFAULT_WEB_PORT = 5173
const workspaceRoot = searchForWorkspaceRoot(import.meta.dirname)
const uiRequire = createRequire(path.join(workspaceRoot, "packages/ui/package.json"))
const interFontFiles = path.join(path.dirname(uiRequire.resolve("@fontsource-variable/inter/package.json")), "files")

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
			// Bun's global store resolves Inter outside the workspace; Vite's strict filesystem check otherwise returns 403.
			allow: [workspaceRoot, interFontFiles],
		},
		// Proxying keeps /api same-origin so the SameSite=Lax session cookie is actually sent (no CORS needed).
		proxy: {
			"/api": `http://localhost:${process.env.TALQO_API_PORT ?? DEFAULT_API_PORT}`,
			"/health": `http://localhost:${process.env.TALQO_API_PORT ?? DEFAULT_API_PORT}`,
		},
	},
})
