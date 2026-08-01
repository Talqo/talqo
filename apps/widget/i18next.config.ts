import { defineConfig, recommendedAcceptedAttributes, recommendedAcceptedTags } from "i18next-cli"

// Same layout and reasoning as apps/web/i18next.config.ts; the widget owns an
// isolated i18n registry with its own locales in src/locales/<lang>.json.
export default defineConfig({
	locales: ["en", "cs", "zh"],
	extract: {
		input: ["src/**/*.{ts,tsx}"],
		output: "src/locales/{{language}}.json",
		// Single file per language with no namespace nesting (defaultNS: false).
		defaultNS: false,
		primaryLanguage: "en",
		indentation: "\t",
		removeUnusedKeys: true,
	},
	lint: {
		acceptedAttributes: recommendedAcceptedAttributes,
		acceptedTags: recommendedAcceptedTags,
	},
})
