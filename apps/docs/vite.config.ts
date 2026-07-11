import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import mdx from "fumadocs-mdx/vite"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [mdx(), tailwindcss(), tanstackStart(), react()],
	resolve: {
		tsconfigPaths: true,
	},
	server: {
		host: "0.0.0.0",
		strictPort: true,
	},
})
