import { defineConfig, recommendedAcceptedAttributes, recommendedAcceptedTags } from "i18next-cli"

export default defineConfig({
	locales: ["en", "cs", "zh"],
	extract: {
		input: ["src/**/*.{ts,tsx}"],
		output: "src/locales/{{language}}.json",
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
