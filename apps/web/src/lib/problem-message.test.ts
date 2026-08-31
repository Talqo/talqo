import { Login400 } from "@/api/generated/models/identity/login400.zod.ts"
import cs from "@/locales/cs.json"
import en from "@/locales/en.json"
import zh from "@/locales/zh.json"
import { describe, expect, it } from "bun:test"

import { getProblemMessage } from "./problem-message.ts"

const translations = {
	"problems.invalid-credentials": "Localized invalid credentials",
} as const

const translate = (key: string) => translations[key as keyof typeof translations]

describe("getProblemMessage", () => {
	it("keeps problem translation keys identical across locales", () => {
		const englishKeys = Object.keys(en.problems).toSorted()
		expect(Object.keys(cs.problems).toSorted()).toEqual(englishKeys)
		expect(Object.keys(zh.problems).toSorted()).toEqual(englishKeys)
	})

	it("keeps generated response code and type pairs aligned", () => {
		expect(
			Login400.safeParse({
				code: "invalid-request",
				type: "https://docs.talqo.chat/problems#invalid-request",
			}).success,
		).toBe(true)
		expect(
			Login400.safeParse({
				code: "invalid-request",
				type: "https://docs.talqo.chat/problems#malformed-json",
			}).success,
		).toBe(false)
	})

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
