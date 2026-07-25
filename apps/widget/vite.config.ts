import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	build: {
		lib: {
			entry: "src/widget.tsx",
			fileName: () => "widget.js",
			formats: ["iife"],
			name: "TalqoWidget",
		},
	},
	plugins: [react()],
	server: {
		host: "0.0.0.0",
		port: Number(process.env.TALQO_WIDGET_PORT ?? 5174),
		strictPort: true,
	},
})
