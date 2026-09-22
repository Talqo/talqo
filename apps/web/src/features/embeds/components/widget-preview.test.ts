import { describe, expect, test } from "bun:test"

import { buildPreviewDocument } from "./widget-preview"

describe("buildPreviewDocument", () => {
	test("boots the deployed widget bundle in preview mode", () => {
		const document = buildPreviewDocument(
			"https://cdn.example.com/widget.js?v=42&channel=stable",
			"https://dashboard.example.com",
		)

		expect(document).toContain('src="https://cdn.example.com/widget.js?v=42&amp;channel=stable"')
		expect(document).toContain("data-talqo-preview")
		expect(document).toContain('data-talqo-parent-origin="https://dashboard.example.com"')
		expect(document).not.toContain("preview.html")
	})
})
