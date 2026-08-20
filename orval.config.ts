import { defineConfig } from "orval"

const input = process.env.ORVAL_INPUT ?? "./apps/api/openapi.json"
const target = process.env.ORVAL_OUTPUT ?? "./apps/web/src/api/generated"

export default defineConfig({
	web: {
		input: {
			target: input,
		},
		output: {
			client: "react-query",
			httpClient: "fetch",
			mode: "tags-split",
			target,
			schemas: {
				path: `${target}/models`,
				type: "zod",
				splitByTags: true,
			},
			clean: true,
			indexFiles: false,
			override: {
				requestOptions: {
					credentials: "include",
				},
				fetch: {
					forceSuccessResponse: true,
					runtimeValidation: true,
				},
				query: {
					shouldExportQueryKey: true,
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
