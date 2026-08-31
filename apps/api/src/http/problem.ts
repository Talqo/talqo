import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { z } from "@hono/zod-openapi"

export const PROBLEM_CODES = {
	ADMIN_ACCESS_REQUIRED: "admin-access-required",
	ADMIN_ALREADY_EXISTS: "admin-already-exists",
	AGENT_INVALID: "agent-invalid",
	AGENT_NAME_TAKEN: "agent-name-taken",
	AGENT_NOT_FOUND: "agent-not-found",
	AUTHENTICATION_REQUIRED: "authentication-required",
	CONFIGURATION_CONFLICT: "configuration-conflict",
	CURRENT_PASSWORD_INCORRECT: "current-password-incorrect",
	INTERNAL_SERVER_ERROR: "internal-server-error",
	INVALID_AI_PROVIDER_CONFIGURATION: "invalid-ai-provider-configuration",
	INVALID_CREDENTIALS: "invalid-credentials",
	INVALID_INVITATION: "invalid-invitation",
	INVALID_REQUEST: "invalid-request",
	MALFORMED_JSON: "malformed-json",
	MODEL_DISCOVERY_UNSUPPORTED: "model-discovery-unsupported",
	PASSWORD_CHANGE_NOT_REQUIRED: "password-change-not-required",
	PASSWORD_CHANGE_REQUIRED: "password-change-required",
	PERMISSION_DENIED: "permission-denied",
	PROVIDER_CREDENTIALS_REJECTED: "provider-credentials-rejected",
	PROVIDER_ERROR: "provider-error",
	PROVIDER_RATE_LIMITED: "provider-rate-limited",
	PROVIDER_UNREACHABLE: "provider-unreachable",
	REQUEST_FAILED: "request-failed",
	ROUTE_NOT_FOUND: "route-not-found",
	SELF_PASSWORD_RESET_NOT_ALLOWED: "self-password-reset-not-allowed",
	USER_NOT_FOUND: "user-not-found",
	USERNAME_TAKEN: "username-taken",
} as const

export type ProblemCode = (typeof PROBLEM_CODES)[keyof typeof PROBLEM_CODES]

const PROBLEM_TYPE_BASE = "https://docs.talqo.chat/problems#" as const
export const PROBLEM_CODE_VALUES = Object.values(PROBLEM_CODES) as [ProblemCode, ...ProblemCode[]]

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

export const problemDetailsSchema = z
	.object({
		code: z.enum(PROBLEM_CODE_VALUES),
		type: z.string().url(),
	})
	.strict()
	.refine((problem) => problem.type === PROBLEMS[problem.code].type, { path: ["type"] })
	.openapi("ProblemDetails")

export function problemSchema(codes: readonly ProblemCode[]) {
	return {
		oneOf: codes.map((code) => ({
			additionalProperties: false,
			properties: {
				code: { const: code, type: "string" },
				type: { const: problemDetails(code).type, type: "string" },
			},
			required: ["code", "type"],
			type: "object",
		})),
	}
}

export const allProblemsOpenApiSchema = problemSchema(PROBLEM_CODE_VALUES)

export function problemResponse<C extends ProblemCode, S extends ContentfulStatusCode>(
	context: Context,
	code: C,
	status: S,
) {
	return context.json(problemDetails(code), status, { "Content-Type": "application/problem+json" })
}
