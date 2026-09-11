import type { ProblemCode } from "./problem.ts"

import { problemDetailsSchema } from "./problem.ts"

export function problemResponse(codes: readonly ProblemCode[]) {
	return {
		"x-problem-codes": codes,
		content: {
			"application/problem+json": {
				schema: problemDetailsSchema,
			},
		},
		description: "https://docs.talqo.chat/problems",
	} as const
}

export const noContentResponse = {
	description: "No content",
} as const

export const sessionSecurity = [{ SessionCookie: [] }]
