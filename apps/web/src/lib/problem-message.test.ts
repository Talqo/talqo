import en from "@/locales/en.json"
import { describe, expect, it } from "bun:test"

import { getProblemMessage } from "./problem-message.ts"

const translations = {
	"problems.invalid-credentials": "Localized invalid credentials",
} as const

const translate = (key: string) => translations[key as keyof typeof translations]

function problem(code: string) {
	return { info: { code, type: `https://docs.talqo.chat/problems#${code}` } }
}

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

	it("maps every dashboard problem code to its translation key", () => {
		for (const code of Object.keys(en.problems)) {
			expect(getProblemMessage(problem(code), (key) => key, "Fallback")).toBe(`problems.${code}`)
		}
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

	it("uses the fallback for ordinary runtime failures without problem details", () => {
		expect(getProblemMessage(new TypeError("Failed to fetch"), translate, "Fallback")).toBe("Fallback")
		expect(getProblemMessage(null, translate, "Fallback")).toBe("Fallback")
		expect(getProblemMessage(undefined, translate, "Fallback")).toBe("Fallback")
		expect(getProblemMessage({ info: undefined }, translate, "Fallback")).toBe("Fallback")
		expect(getProblemMessage({ info: "invalid-credentials" }, translate, "Fallback")).toBe("Fallback")
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
