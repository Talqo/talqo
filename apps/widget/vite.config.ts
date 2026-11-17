import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import cssInjectedByJs from "vite-plugin-css-injected-by-js"
import svgr from "vite-plugin-svgr"

import { widgetCssPlugin } from "./vite.css.ts"

const DEFAULT_WIDGET_PORT = 5174

export default defineConfig({
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
	build: {
		reportCompressedSize: true,
		emptyOutDir: false,
		lib: {
			entry: "src/chat.tsx",
			fileName: () => "widget-chat.js",
			formats: ["iife"],
			name: "TalqoWidgetChatModule",
		},
		rollupOptions: {
			output: {
				assetFileNames: "widget.[ext]",
			},
		},
	},
	plugins: [react(), svgr(), tailwindcss(), widgetCssPlugin(), cssInjectedByJs()],
	resolve: {
		alias: {
			"@": `${import.meta.dirname}/src`,
		},
	},
	server: {
		host: "0.0.0.0",
		port: Number(process.env.TALQO_WIDGET_PORT ?? DEFAULT_WIDGET_PORT),
		strictPort: true,
	},
})
