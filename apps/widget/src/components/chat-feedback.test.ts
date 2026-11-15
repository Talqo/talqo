import type { ChatError, ChatErrorCode, ChatMessage } from "@talqo/sdk"

import { describe, expect, test } from "bun:test"

import { errorText, outcomeText } from "./chat-feedback"

const translate = (key: string) => `t:${key}`

describe("errorText", () => {
	const cases = [
		["invalid-request", "errorInvalidRequest"],
		["malformed-json", "errorMalformedJson"],
		["chat-client-address-unavailable", "errorClientAddressUnavailable"],
		["chat-conversation-too-long", "errorConversationTooLong"],
		["chat-daily-allowance-exceeded", "errorDailyAllowance"],
		["chat-concurrency-limit", "errorConcurrencyLimit"],
		["chat-session-busy", "errorSessionBusy"],
		["chat-request-conflict", "errorRequestConflict"],
		["chat-session-unauthorized", "errorSessionUnauthorized"],
		["chat-context-limit", "errorContextLimit"],
		["chat-input-incompatible", "errorInputIncompatible"],
		["payload-too-large", "errorPayloadTooLarge"],
		["provider-error", "errorProvider"],
		["internal-server-error", "errorInternalServer"],
		["embed-not-found", "errorEmbedNotFound"],
		["embed-disabled", "errorEmbedDisabled"],
		["request-failed", "errorRequestFailed"],
		["invalid-response", "errorInvalidResponse"],
		["transport-error", "errorTransport"],
		["storage-unavailable", "errorStorageUnavailable"],
		["cancel-failed", "errorCancelFailed"],
		["reset-failed", "errorResetFailed"],
		["chat-unavailable", "chatUnavailable"],
	] as const satisfies readonly (readonly [ChatErrorCode, string])[]

	test("maps every SDK error code to its own message key", () => {
		for (const [code, key] of cases) {
			expect(errorText({ code } satisfies ChatError, translate)).toBe(`t:${key}`)
		}
	})
})

describe("outcomeText", () => {
	const cases = [
		["failed", "outcomeFailed"],
		["cancelled", "outcomeCancelled"],
		["blocked", "outcomeBlocked"],
		["interrupted", "outcomeInterrupted"],
	] as const satisfies readonly (readonly [ChatMessage["outcome"], string])[]

	test("labels every terminal failure outcome", () => {
		for (const [outcome, key] of cases) {
			expect(outcomeText(outcome, translate)).toBe(`t:${key}`)
		}
	})

	test("has no label for non-terminal or successful outcomes", () => {
		for (const outcome of ["pending", "streaming", "completed"] as const) {
			expect(outcomeText(outcome, translate)).toBeUndefined()
		}
	})
})
