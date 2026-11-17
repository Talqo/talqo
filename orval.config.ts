import { defineConfig } from "orval"

export default defineConfig({
	sdk: {
		input: {
			target: "./apps/api/openapi.json",
			filters: { tags: ["Public Chat"] },
		},
		output: {
			client: "fetch",
			mode: "single",
			target: "./packages/sdk/src/generated/contracts.ts",
			clean: true,
		},
	},
	web: {
		input: {
			target: "./apps/api/openapi.json",
			filters: {
				tags: [
					"Health",
					"AI Providers",
					"Identity",
					"Roles",
					"Agent",
					"Embed",
					"MCP",
					"Stats",
					"Conversation",
					"Test Chat",
				],
				schemas: ["ProblemDetails"],
			},
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
				operations: {
					// An SSE body is not JSON; the dashboard streams it through the SDK transport instead.
					sendTestChatMessage: { fetch: { forceSuccessResponse: false } },
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
