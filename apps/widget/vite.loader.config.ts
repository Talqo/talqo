import { defineConfig } from "vite"
import cssInjectedByJs from "vite-plugin-css-injected-by-js"

import { widgetCssPlugin } from "./vite.css.ts"

export default defineConfig({
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
	plugins: [widgetCssPlugin(), cssInjectedByJs()],
	build: {
		reportCompressedSize: true,
		assetsInlineLimit: Number.MAX_SAFE_INTEGER,
		lib: {
			entry: "src/widget.ts",
			fileName: () => "widget.js",
			formats: ["iife"],
			name: "TalqoWidget",
		},
		rollupOptions: {
			output: {
				assetFileNames: "widget.[ext]",
			},
		},
	},
	resolve: {
		alias: {
			"@": `${import.meta.dirname}/src`,
		},
	},
})
