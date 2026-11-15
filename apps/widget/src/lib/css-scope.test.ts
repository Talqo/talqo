import { describe, expect, test } from "bun:test"

import { isScopedSelector, WIDGET_SCOPE } from "./css-scope"

describe("isScopedSelector", () => {
	test("recognizes selectors already scoped to the widget or its tw: utilities", () => {
		const cases = [
			[WIDGET_SCOPE, true],
			[`${WIDGET_SCOPE} .child`, true],
			[`${WIDGET_SCOPE}.dark`, true],
			[`:where(${WIDGET_SCOPE})`, true],
			[`:where(${WIDGET_SCOPE}) .child`, true],
			[".child .tw\\:flex", true],
			[".tw\\:bg-primary:hover", true],
			[".child", false],
			["div .talqo-widget", false],
			[".foo[data-x='.talqo-widget']", false],
			[".foo.tw-child", false],
			[":where(.other)", false],
			["", false],
		] as const

		for (const [selector, expected] of cases) {
			expect(isScopedSelector(selector)).toBe(expected)
		}
	})
})
