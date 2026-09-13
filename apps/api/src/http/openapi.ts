import type { ProblemCodeSet } from "./problem.ts"

import { PROBLEM_CODES, problemSchema } from "./problem.ts"

export function problemResponse(codes: ProblemCodeSet) {
	return {
		content: {
			"application/problem+json": {
				schema: problemSchema(codes),
			},
		},
		description: "https://docs.talqo.chat/problems",
	} as const
}

export const payloadTooLargeResponse = problemResponse([PROBLEM_CODES.PAYLOAD_TOO_LARGE])

export const noContentResponse = {
	description: "No content",
} as const

export const sessionSecurity = [{ SessionCookie: [] }]
