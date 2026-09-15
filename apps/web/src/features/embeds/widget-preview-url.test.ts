import { describe, expect, test } from "bun:test"

import { widgetPreviewUrl } from "./widget-preview-url"

describe("widgetPreviewUrl", () => {
	test("prefers an explicit preview URL", () => {
		expect(widgetPreviewUrl("https://preview.example.com/widget", "https://cdn.example.com/widget.js")).toBe(
			"https://preview.example.com/widget",
		)
	})

	test("derives the deployed preview page from the widget script", () => {
		expect(widgetPreviewUrl(undefined, "https://cdn.example.com/talqo/widget.js")).toBe(
			"https://cdn.example.com/talqo/preview.html",
		)
	})

	test("carries the widget cache key to preview assets", () => {
		expect(widgetPreviewUrl(undefined, "https://cdn.example.com/widget.js?v=42")).toBe(
			"https://cdn.example.com/preview.html?widgetAssetQuery=v%3D42",
		)
	})

	test("returns undefined when neither URL is configured", () => {
		expect(widgetPreviewUrl(undefined, undefined)).toBeUndefined()
	})
})
