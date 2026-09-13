import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { z } from "@hono/zod-openapi"

export const PROBLEM_CODES = {
	ADMIN_ACCESS_REQUIRED: "admin-access-required",
	ADMIN_ALREADY_EXISTS: "admin-already-exists",
	AGENT_FILE_INVALID: "agent-file-invalid",
	AGENT_FILE_NAME_TAKEN: "agent-file-name-taken",
	AGENT_FILE_NOT_FOUND: "agent-file-not-found",
	AGENT_INVALID: "agent-invalid",
	AGENT_IN_USE: "agent-in-use",
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
	PAYLOAD_TOO_LARGE: "payload-too-large",
	PERMISSION_DENIED: "permission-denied",
	PROVIDER_CREDENTIALS_REJECTED: "provider-credentials-rejected",
	PROVIDER_ERROR: "provider-error",
	PROVIDER_RATE_LIMITED: "provider-rate-limited",
	PROVIDER_UNREACHABLE: "provider-unreachable",
	REQUEST_FAILED: "request-failed",
	ROUTE_NOT_FOUND: "route-not-found",
	SELF_PASSWORD_RESET_NOT_ALLOWED: "self-password-reset-not-allowed",
	USER_NOT_FOUND: "user-not-found",
	WIDGET_NOT_FOUND: "widget-not-found",
	USERNAME_TAKEN: "username-taken",
} as const

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

function problemSchemaName(codes: readonly ProblemCode[]) {
	const suffix = codes
		.map((code) =>
			code
				.split("-")
				.map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
				.join(""),
		)
		.join("Or")
	return `Problem${suffix}`
}

function createProblemSchema(codes: readonly ProblemCode[], name: string) {
	const alternatives = codes.map((code) =>
		z
			.object({
				code: z.literal(code),
				type: z.literal(problemDetails(code).type),
			})
			.strict(),
	)
	return z.union(alternatives).openapi(name, undefined, { unionPreferredType: "oneOf" })
}

const problemSchemas = new Map<string, ReturnType<typeof createProblemSchema>>()

export function problemSchema(codes: ProblemCodeSet) {
	const canonicalCodes = [...new Set(codes)].toSorted()
	const componentName = problemSchemaName(canonicalCodes)
	const existing = problemSchemas.get(componentName)
	if (existing) return existing

	const schema = createProblemSchema(canonicalCodes, componentName)
	problemSchemas.set(componentName, schema)
	return schema
}

export const problemDetailsSchema = createProblemSchema(PROBLEM_CODE_VALUES, "ProblemDetails")

export function problemResponse<C extends ProblemCode, S extends ContentfulStatusCode>(
	context: Context,
	code: C,
	status: S,
) {
	return context.json(problemDetails(code), status, { "Content-Type": "application/problem+json" })
}
