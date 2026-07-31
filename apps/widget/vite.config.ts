import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { defineConfig, type Plugin } from "vite"

function withoutLayerBlock(css: string, layerName: string): string {
	const match = new RegExp(`@layer ${layerName}\\s*\\{`).exec(css)
	if (!match) {
		return css
	}
	let depth = 0
	for (let i = match.index + match[0].length - 1; i < css.length; i++) {
		if (css[i] === "{") {
			depth++
		} else if (css[i] === "}") {
			depth--
			if (depth === 0) {
				return css.slice(0, match.index) + css.slice(i + 1)
			}
		}
	}
	throw new Error(`widgetCss: unbalanced braces in @layer ${layerName}`)
}

// The widget ships into arbitrary host pages, so nothing in its CSS may touch
// the global cascade: Tailwind preflight is removed, theme variables move from
// :root under .talqo-widget, and the @property default-value layer is scoped
// the same way. Runs on the emitted asset only; the dev harness hosts the
// widget alone, so preflight is harmless there.
function scopeWidgetCss(css: string): string {
	return withoutLayerBlock(css, "base")
		.replace(/:root\s*,\s*:host(?=\s*\{)/g, ".talqo-widget")
		.replace(
			/\*\s*,\s*:{1,2}before\s*,\s*:{1,2}after\s*,\s*::backdrop(?=\s*\{)/g,
			".talqo-widget,.talqo-widget *,.talqo-widget *::before,.talqo-widget *::after,.talqo-widget ::backdrop",
		)
}

function widgetCssPlugin(): Plugin {
	let outDir = "dist"
	return {
		name: "talqo-widget-css",
		apply: "build",
		configResolved: (config) => {
			outDir = path.resolve(config.root, config.build.outDir)
		},
		// The CSS asset does not exist yet at generateBundle time in this Vite
		// version (rolldown lib mode), so transform the written file instead.
		closeBundle: async () => {
			const file = path.join(outDir, "widget.css")
			const css = await readFile(file, "utf8")
			await writeFile(file, scopeWidgetCss(css))
		},
	}
}

export default defineConfig({
	build: {
		lib: {
			entry: "src/widget.tsx",
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
	plugins: [react(), tailwindcss(), widgetCssPlugin()],
	resolve: {
		alias: {
			"@": `${import.meta.dirname}/src`,
		},
	},
	server: {
		host: "0.0.0.0",
		port: Number(process.env.TALQO_WIDGET_PORT ?? 5174),
		strictPort: true,
	},
})
