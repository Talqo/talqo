import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [tanstackRouter({ autoCodeSplitting: true }), react(), tailwindcss()],
	resolve: {
		alias: {
			"@": `${import.meta.dirname}/src`,
		},
	},
	server: {
		host: "0.0.0.0",
		port: Number(process.env.TALQO_WEB_PORT ?? 5173),
		strictPort: true,
		// Proxying keeps the browser's view of /api same-origin as the web app, so the
		// SameSite=Lax session cookie is actually sent -- a cross-port fetch() wouldn't
		// carry it. No CORS setup needed either.
		proxy: {
			"/api": `http://localhost:${process.env.TALQO_API_PORT ?? 3000}`,
			"/health": `http://localhost:${process.env.TALQO_API_PORT ?? 3000}`,
		},
	},
})
