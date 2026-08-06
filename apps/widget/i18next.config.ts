import { defineConfig, recommendedAcceptedAttributes, recommendedAcceptedTags } from "i18next-cli"

// Flat single-file-per-language layout, same as apps/web/i18next.config.ts.
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
