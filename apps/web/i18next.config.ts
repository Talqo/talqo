import { defineConfig, recommendedAcceptedAttributes, recommendedAcceptedTags } from "i18next-cli"

// Locales are bundled from src/locales/<lang>.json: flat single file per
// language, no namespace nesting.
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
		ignore: ["src/routeTree.gen.ts"],
	},
})
