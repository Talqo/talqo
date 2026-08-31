import type { ProblemDetails } from "@/api/generated/models/problemDetails.zod.ts"

type ProblemCode = ProblemDetails["code"]
type Translate = (key: string) => string

const PROBLEM_PROPERTY_COUNT = 2

const PROBLEM_TRANSLATORS = {
	"admin-access-required": (t) => t("problems.admin-access-required"),
	"admin-already-exists": (t) => t("problems.admin-already-exists"),
	"agent-invalid": (t) => t("problems.agent-invalid"),
	"agent-name-taken": (t) => t("problems.agent-name-taken"),
	"agent-not-found": (t) => t("problems.agent-not-found"),
	"authentication-required": (t) => t("problems.authentication-required"),
	"configuration-conflict": (t) => t("problems.configuration-conflict"),
	"current-password-incorrect": (t) => t("problems.current-password-incorrect"),
	"internal-server-error": (t) => t("problems.internal-server-error"),
	"invalid-ai-provider-configuration": (t) => t("problems.invalid-ai-provider-configuration"),
	"invalid-credentials": (t) => t("problems.invalid-credentials"),
	"invalid-invitation": (t) => t("problems.invalid-invitation"),
	"invalid-request": (t) => t("problems.invalid-request"),
	"malformed-json": (t) => t("problems.malformed-json"),
	"model-discovery-unsupported": (t) => t("problems.model-discovery-unsupported"),
	"password-change-not-required": (t) => t("problems.password-change-not-required"),
	"password-change-required": (t) => t("problems.password-change-required"),
	"permission-denied": (t) => t("problems.permission-denied"),
	"provider-credentials-rejected": (t) => t("problems.provider-credentials-rejected"),
	"provider-error": (t) => t("problems.provider-error"),
	"provider-rate-limited": (t) => t("problems.provider-rate-limited"),
	"provider-unreachable": (t) => t("problems.provider-unreachable"),
	"request-failed": (t) => t("problems.request-failed"),
	"route-not-found": (t) => t("problems.route-not-found"),
	"self-password-reset-not-allowed": (t) => t("problems.self-password-reset-not-allowed"),
	"user-not-found": (t) => t("problems.user-not-found"),
	"username-taken": (t) => t("problems.username-taken"),
} satisfies Record<ProblemCode, (translate: Translate) => string>

function isExactProblem(value: unknown): value is ProblemDetails {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false
	if (Object.keys(value).length !== PROBLEM_PROPERTY_COUNT || !("code" in value) || !("type" in value)) return false
	if (typeof value.code !== "string" || typeof value.type !== "string") return false
	if (!Object.hasOwn(PROBLEM_TRANSLATORS, value.code)) return false
	return value.type === `https://docs.talqo.chat/problems#${value.code}`
}

export function getProblemMessage(error: unknown, translate: Translate, fallback: string): string {
	const info = (error as { info?: unknown } | null)?.info
	if (!isExactProblem(info)) return fallback
	return PROBLEM_TRANSLATORS[info.code](translate)
}
