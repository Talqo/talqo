import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [fumadocsMdx(), tailwindcss(), tanstackStart(), react()],
	resolve: {
		tsconfigPaths: true,
	},
	environments: {
		// The runtime image ships only `dist`, so the SSR bundle must carry its own dependencies.
		ssr: { resolve: { noExternal: true } },
	},
	server: {
		host: "0.0.0.0",
	},
})
