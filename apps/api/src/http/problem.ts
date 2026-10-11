import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { z } from "@hono/zod-openapi"
import { PROBLEM_CODES } from "@talqo/shared/problem-codes"

export { PROBLEM_CODES }

export type ProblemCode = (typeof PROBLEM_CODES)[keyof typeof PROBLEM_CODES]
export type ProblemCodeSet = readonly [ProblemCode, ...ProblemCode[]]

const PROBLEM_TYPE_BASE = "https://docs.talqo.chat/problems#" as const
const [firstProblemCode, ...remainingProblemCodes] = Object.values(PROBLEM_CODES)
if (!firstProblemCode) throw new Error("At least one problem code is required")
const PROBLEM_CODE_VALUES = [firstProblemCode, ...remainingProblemCodes] satisfies ProblemCodeSet

export type ProblemDetails = {
	readonly code: ProblemCode
	readonly type: `${typeof PROBLEM_TYPE_BASE}${ProblemCode}`
}

export function problemDetails<C extends ProblemCode>(code: C) {
	return Object.freeze({
		code,
		type: `${PROBLEM_TYPE_BASE}${code}` as `${typeof PROBLEM_TYPE_BASE}${C}`,
	})
}

export const PROBLEMS = Object.freeze(
	Object.fromEntries(PROBLEM_CODE_VALUES.map((code) => [code, problemDetails(code)])) as Readonly<
		Record<ProblemCode, ProblemDetails>
	>,
)

const [firstProblemSchema, ...remainingProblemSchemas] = PROBLEM_CODE_VALUES.map((code) =>
	z
		.object({
			code: z.literal(code),
			type: z.literal(problemDetails(code).type),
		})
		.strict(),
)
if (!firstProblemSchema) throw new Error("At least one problem schema is required")

export const problemDetailsSchema = z
	.union([firstProblemSchema, ...remainingProblemSchemas])
	.openapi("ProblemDetails", undefined, { unionPreferredType: "oneOf" })

export function problemSchema() {
	return problemDetailsSchema
}

export function problemResponse<C extends ProblemCode, S extends ContentfulStatusCode>(
	context: Context,
	code: C,
	status: S,
) {
	return context.json(problemDetails(code), status, { "Content-Type": "application/problem+json" })
}
