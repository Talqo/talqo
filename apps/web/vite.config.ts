import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const DEFAULT_API_PORT = 3000
const DEFAULT_WEB_PORT = 5173

export default defineConfig({
	plugins: [tanstackRouter({ autoCodeSplitting: true }), react(), tailwindcss()],
	resolve: {
		alias: {
			"@": `${import.meta.dirname}/src`,
		},
	},
	server: {
		host: "0.0.0.0",
		port: Number(process.env.TALQO_WEB_PORT ?? DEFAULT_WEB_PORT),
		strictPort: true,
		// Inotify events do not reach bind-mounted workspaces (Docker containers), so fall
		// back to polling to keep HMR transforms fresh there.
		watch: process.env.TALQO_VITE_POLLING === "true" ? { usePolling: true } : undefined,
		// Proxying keeps /api same-origin so the SameSite=Lax session cookie is actually sent (no CORS needed).
		proxy: {
			"/api": `http://localhost:${process.env.TALQO_API_PORT ?? DEFAULT_API_PORT}`,
			"/health": `http://localhost:${process.env.TALQO_API_PORT ?? DEFAULT_API_PORT}`,
		},
	},
})
