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
	CHAT_CLIENT_ADDRESS_UNAVAILABLE: "chat-client-address-unavailable",
	CHAT_CONCURRENCY_LIMIT: "chat-concurrency-limit",
	CHAT_CONTEXT_LIMIT: "chat-context-limit",
	CHAT_CONVERSATION_TOO_LONG: "chat-conversation-too-long",
	CHAT_DAILY_ALLOWANCE_EXCEEDED: "chat-daily-allowance-exceeded",
	CHAT_INPUT_INCOMPATIBLE: "chat-input-incompatible",
	CHAT_REQUEST_CONFLICT: "chat-request-conflict",
	CHAT_SESSION_BUSY: "chat-session-busy",
	CHAT_SESSION_UNAUTHORIZED: "chat-session-unauthorized",
	CONFIGURATION_CONFLICT: "configuration-conflict",
	CURRENT_PASSWORD_INCORRECT: "current-password-incorrect",
	EMBED_NOT_FOUND: "embed-not-found",
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
	SELF_DELETE_NOT_ALLOWED: "self-delete-not-allowed",
	SELF_PASSWORD_RESET_NOT_ALLOWED: "self-password-reset-not-allowed",
	USER_NOT_FOUND: "user-not-found",
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
