import { describe, expect, it } from "bun:test"

import { getProblemMessage } from "./problem-message.ts"

const translations = {
	"problems.invalid-credentials": "Localized invalid credentials",
} as const

const translate = (key: string) => translations[key as keyof typeof translations]

describe("getProblemMessage", () => {
	it("localizes a known exact problem", () => {
		const error = {
			info: {
				code: "invalid-credentials",
				type: "https://docs.talqo.chat/problems#invalid-credentials",
			},
		}

		expect(getProblemMessage(error, translate, "Fallback")).toBe("Localized invalid credentials")
	})

	it("uses the localized fallback for unknown codes", () => {
		const error = {
			info: {
				code: "future-problem",
				type: "https://docs.talqo.chat/problems#future-problem",
			},
		}

		expect(getProblemMessage(error, translate, "Fallback")).toBe("Fallback")
	})

	it("uses the localized fallback for valid problems outside the web API", () => {
		const error = {
			info: {
				code: "chat-session-busy",
				type: "https://docs.talqo.chat/problems#chat-session-busy",
			},
		}

		expect(getProblemMessage(error, translate, "Fallback")).toBe("Fallback")
	})

	it("uses the localized fallback for malformed problem bodies", () => {
		const mismatched = {
			info: {
				code: "invalid-credentials",
				type: "https://docs.talqo.chat/problems#internal-server-error",
			},
		}
		const extended = {
			info: {
				code: "invalid-credentials",
				detail: "Do not display me",
				type: "https://docs.talqo.chat/problems#invalid-credentials",
			},
		}

		expect(getProblemMessage(mismatched, translate, "Fallback")).toBe("Fallback")
		expect(getProblemMessage(extended, translate, "Fallback")).toBe("Fallback")
	})
})
