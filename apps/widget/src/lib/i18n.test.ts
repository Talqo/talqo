import { describe, expect, test } from "bun:test"

import { createWidgetI18n } from "./i18n"

describe("createWidgetI18n", () => {
	test("translates in the requested language and defaults to English", () => {
		expect(createWidgetI18n().t("openChat")).toBe("Open chat")
		expect(createWidgetI18n("cs").t("openChat")).toBe("Otevřít chat")
	})

	test("interpolates translations without HTML-escaping the value", () => {
		expect(createWidgetI18n().t("retryAfter", { reset: "<b>" })).toBe("Try again after <b>.")
		expect(createWidgetI18n("cs").t("retryAfter", { reset: "<b>" })).toBe("Zkuste to znovu po <b>.")
	})

	test("configures English as the fallback locale", () => {
		expect(createWidgetI18n("cs").options.fallbackLng).toEqual(["en"])
	})
})
