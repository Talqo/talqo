import { describe, expect, test } from "bun:test"

import { isChatErrorCode } from "./types"

const API_CHAT_ERROR_CODES = [
	"invalid-request",
	"malformed-json",
	"chat-client-address-unavailable",
	"chat-conversation-too-long",
	"chat-daily-allowance-exceeded",
	"chat-concurrency-limit",
	"chat-session-busy",
	"chat-request-conflict",
	"chat-session-unauthorized",
	"chat-context-limit",
	"chat-input-incompatible",
	"payload-too-large",
	"provider-error",
	"internal-server-error",
	"embed-disabled",
	"embed-not-found",
	"request-failed",
] as const

const SDK_ERROR_CODES = [
	"invalid-response",
	"transport-error",
	"storage-unavailable",
	"cancel-failed",
	"reset-failed",
	"chat-unavailable",
] as const

describe("isChatErrorCode", () => {
	test("accepts every API and SDK error code", () => {
		for (const code of [...API_CHAT_ERROR_CODES, ...SDK_ERROR_CODES]) expect(isChatErrorCode(code), code).toBe(true)
	})

	test("rejects unknown codes and non-string values", () => {
		const cases: Array<unknown> = [
			"",
			"invalid-response ",
			" invalid-response",
			"chat-unknown",
			"admin-already-exists",
			42,
			null,
			undefined,
			{},
			[],
			["invalid-response"],
			true,
		]
		for (const value of cases) expect(isChatErrorCode(value), String(value)).toBe(false)
	})
})
