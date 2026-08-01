import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parse, type AtRule, type Root } from "postcss"
import { defineConfig, type Plugin } from "vite"

const SCOPE = ".talqo-widget"

// Embed CSS must not restyle the host page: strip preflight/@property rules
// and scope the rest under .talqo-widget. Dev CSS is unscoped.
function scopeWidgetCss(css: string): string {
	const root = parse(css)

	root.walkAtRules("layer", (atRule) => {
		if (atRule.params === "base") {
			atRule.remove()
		}
	})
	// @property registrations are global by definition and emitted for --tw-*
	// variables; utilities still work via the initial values set under SCOPE.
	root.walkAtRules("property", (atRule) => {
		atRule.remove()
	})

	root.walkRules((rule) => {
		rule.selectors = rule.selectors.map((selector) => {
			switch (selector) {
				case ":root":
				case ":host":
					return SCOPE
				case "*":
					return `${SCOPE} *`
				case "::before":
				case ":before":
					return `${SCOPE} *::before`
				case "::after":
				case ":after":
					return `${SCOPE} *::after`
				case "::backdrop":
					return `${SCOPE} ::backdrop`
				default:
					return selector
			}
		})
	})

	assertNoGlobalRules(root)
	return root.toString()
}

// @keyframes pass (their names are global by CSS nature); @font-face fails
// closed until a scoped embedding story exists.
function assertNoGlobalRules(root: Root): void {
	const leaked: string[] = []
	root.walkAtRules("font-face", () => {
		leaked.push("@font-face")
	})
	root.walkAtRules("property", (atRule) => {
		leaked.push(`@property ${atRule.params}`)
	})
	root.walkRules((rule) => {
		const { parent } = rule
		if (parent?.type === "atrule" && (parent as AtRule).name === "keyframes") {
			return
		}
		for (const selector of rule.selectors) {
			if (!selector.startsWith(SCOPE) && !selector.includes(".tw\\:")) {
				leaked.push(selector)
			}
		}
	})
	if (leaked.length > 0) {
		throw new Error(`widgetCss: global CSS survived scoping: ${leaked.slice(0, 5).join(", ")}`)
	}
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
			const assets = (await readdir(outDir)).filter((asset) => asset.endsWith(".css"))
			if (assets.length === 0) {
				throw new Error("widgetCss: no CSS asset emitted to scope")
			}
			await Promise.all(
				assets.map(async (asset) => {
					const file = path.join(outDir, asset)
					await writeFile(file, scopeWidgetCss(await readFile(file, "utf8")))
				}),
			)
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
