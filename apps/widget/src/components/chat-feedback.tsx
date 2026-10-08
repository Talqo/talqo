import type { ChatError, ChatMessage } from "@talqo/sdk"

type Translate = (key: string, options?: Record<string, unknown>) => string
type ErrorTranslator = (t: Translate, error: ChatError) => string

const ERROR_TRANSLATORS: Record<ChatError["code"], ErrorTranslator> = {
	"invalid-request": (t) => t("errorInvalidRequest"),
	"malformed-json": (t) => t("errorMalformedJson"),
	"chat-client-address-unavailable": (t) => t("errorClientAddressUnavailable"),
	"chat-conversation-too-long": (t) => t("errorConversationTooLong"),
	"chat-daily-allowance-exceeded": (t, error) =>
		t("errorDailyAllowance", {
			reset: error.retryAt ? new Date(error.retryAt).toLocaleString() : t("nextUtcDay"),
		}),
	"chat-concurrency-limit": (t) => t("errorConcurrencyLimit"),
	"chat-session-busy": (t) => t("errorSessionBusy"),
	"chat-request-conflict": (t) => t("errorRequestConflict"),
	"chat-session-unauthorized": (t) => t("errorSessionUnauthorized"),
	"chat-context-limit": (t) => t("errorContextLimit"),
	"chat-input-incompatible": (t) => t("errorInputIncompatible"),
	"payload-too-large": (t) => t("errorPayloadTooLarge"),
	"provider-error": (t) => t("errorProvider"),
	"internal-server-error": (t) => t("errorInternalServer"),
	"embed-not-found": (t) => t("errorEmbedNotFound"),
	"embed-disabled": (t) => t("errorEmbedDisabled"),
	"request-failed": (t) => t("errorRequestFailed"),
	"invalid-response": (t) => t("errorInvalidResponse"),
	"transport-error": (t) => t("errorTransport"),
	"storage-unavailable": (t) => t("errorStorageUnavailable"),
	"cancel-failed": (t) => t("errorCancelFailed"),
	"reset-failed": (t) => t("errorResetFailed"),
	"chat-unavailable": (t) => t("chatUnavailable"),
}

const NEW_CHAT_ERROR_CODES = new Set<ChatError["code"]>([
	"chat-conversation-too-long",
	"chat-context-limit",
	"chat-session-unauthorized",
])

export function errorText(error: ChatError, t: Translate): string {
	return ERROR_TRANSLATORS[error.code](t, error)
}

export function errorAllowsNewChat(error: ChatError): boolean {
	return error.newChatAvailable ?? NEW_CHAT_ERROR_CODES.has(error.code)
}

const outcomeKeys = {
	failed: "outcomeFailed",
	cancelled: "outcomeCancelled",
	blocked: "outcomeBlocked",
	interrupted: "outcomeInterrupted",
} as const satisfies Partial<Record<ChatMessage["outcome"], string>>

export function outcomeText(outcome: ChatMessage["outcome"], t: Translate): string | undefined {
	if (!(outcome in outcomeKeys)) return undefined
	return t(outcomeKeys[outcome as keyof typeof outcomeKeys])
}

const SECOND_RESPONSE_DOT_DELAY_MS = 150
const THIRD_RESPONSE_DOT_DELAY_MS = 300
const RESPONSE_DOT_DELAYS_MS = [0, SECOND_RESPONSE_DOT_DELAY_MS, THIRD_RESPONSE_DOT_DELAY_MS] as const

export function ResponseIndicator({ label }: { label: string }) {
	return (
		<span role="status">
			<span className="tw:sr-only">{label}</span>
			<span aria-hidden="true" className="tw:flex tw:h-5 tw:items-center tw:gap-1">
				{RESPONSE_DOT_DELAYS_MS.map((delay) => (
					<span
						key={delay}
						className="tw:size-1.5 tw:animate-bounce tw:rounded-full tw:bg-current tw:motion-reduce:animate-none"
						style={{ animationDelay: `${delay}ms` }}
					/>
				))}
			</span>
		</span>
	)
}
