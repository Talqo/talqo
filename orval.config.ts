import { defineConfig } from "orval"

export default defineConfig({
	web: {
		input: {
			target: "./apps/api/openapi.json",
		},
		output: {
			client: "react-query",
			httpClient: "fetch",
			mode: "tags-split",
			target: "./apps/web/src/api/generated",
			schemas: {
				path: "./apps/web/src/api/generated/models",
				type: "zod",
				splitByTags: true,
			},
			clean: true,
			indexFiles: false,
			// Repo root declares no client deps; detection else falls back to react-query v4.
			packageJson: "./apps/web/package.json",
			override: {
				requestOptions: {
					credentials: "include",
				},
				fetch: {
					forceSuccessResponse: true,
				},
				query: {
					shouldExportKeys: true,
					signal: true,
				},
				zod: {
					generateReusableSchemas: true,
					variant: "classic",
					version: 4,
				},
			},
		},
	},
})
