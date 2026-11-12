import type { Plugin } from "vite"

import { type AtRule, parse, type Root } from "postcss"

import { isScopedSelector, WIDGET_SCOPE } from "./src/lib/css-scope.ts"

const MAX_LEAKED_SELECTORS = 5

function scopeWidgetCss(css: string): string {
	const root = parse(css)

	root.walkAtRules("layer", (atRule) => {
		if (atRule.params === "base") {
			atRule.remove()
			return
		}
		atRule.replaceWith(...(atRule.nodes ?? []))
	})
	root.walkAtRules("property", (atRule) => {
		atRule.remove()
	})

	root.walkAtRules("supports", (atRule) => {
		if (atRule.params.includes("-webkit-hyphens")) {
			atRule.replaceWith(...(atRule.nodes ?? []))
		}
	})

	root.walkRules((rule) => {
		rule.selectors = rule.selectors.map((selector) => {
			switch (selector) {
				case ":root":
				case ":host":
					return WIDGET_SCOPE
				case "*":
					return `${WIDGET_SCOPE} *`
				case "::before":
				case ":before":
					return `${WIDGET_SCOPE} *::before`
				case "::after":
				case ":after":
					return `${WIDGET_SCOPE} *::after`
				case "::backdrop":
					return `${WIDGET_SCOPE} ::backdrop`
				default:
					return selector
			}
		})
	})

	assertNoGlobalRules(root)
	return root.toString()
}

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
			if (!isScopedSelector(selector)) {
				leaked.push(selector)
			}
		}
	})
	if (leaked.length > 0) {
		throw new Error(`widgetCss: global CSS survived scoping: ${leaked.slice(0, MAX_LEAKED_SELECTORS).join(", ")}`)
	}
}

/**
 * Runs on the emitted asset because Tailwind expands CSS after transform hooks. Leaving our
 * CSS unlayered keeps a host's `@layer base` preflight from outranking it.
 */
export function widgetCssPlugin(): Plugin {
	return {
		name: "talqo-widget-css",
		apply: "build",
		enforce: "post",
		generateBundle(_options, bundle) {
			for (const asset of Object.values(bundle)) {
				if (asset.type === "asset" && asset.fileName.endsWith(".css")) {
					asset.source = scopeWidgetCss(String(asset.source))
				}
			}
		},
	}
}
