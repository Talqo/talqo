import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { defineConfig } from "vite"

export default defineConfig(({ command }) => ({
	plugins: [fumadocsMdx(), tailwindcss(), tanstackStart(), react()],
	resolve: {
		tsconfigPaths: true,
	},
	// Build-only: it breaks dev SSR, and the image ships no node_modules.
	...(command === "build"
		? {
				environments: {
					ssr: { resolve: { noExternal: true } },
				},
			}
		: {}),
	server: {
		host: "0.0.0.0",
	},
}))
