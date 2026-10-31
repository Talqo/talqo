import { defineConfig, recommendedAcceptedAttributes } from "i18next-cli"

// Lint-only: this package renders labels supplied by callers and owns no locale files.
export default defineConfig({
	locales: [],
	extract: {
		input: ["src/**/*.{ts,tsx}"],
		output: "src/locales/{{language}}.json",
	},
	lint: {
		acceptedAttributes: recommendedAcceptedAttributes,
		acceptedTags: "all",
	},
})
