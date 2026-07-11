import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const directory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [tanstackRouter({ autoCodeSplitting: true }), react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(directory, "src"),
		},
	},
	server: {
		host: "0.0.0.0",
	},
})
