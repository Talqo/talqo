import { describe, expect, test } from "bun:test"

import { docHead } from "./doc-metadata"

describe("documentation page metadata", () => {
	test("publishes canonical HTML and Markdown addresses and page-specific social metadata", () => {
		const head = docHead({
			title: "Deployment",
			description: "Run Talqo on your infrastructure.",
			url: "https://docs.example/deployment",
			markdownUrl: "https://docs.example/deployment.md",
		})
		expect(head.links).toContainEqual({ rel: "canonical", href: "https://docs.example/deployment" })
		expect(head.links).toContainEqual({
			rel: "alternate",
			type: "text/markdown",
			href: "https://docs.example/deployment.md",
		})
		for (const tag of [
			{ title: "Deployment | Talqo Docs" },
			{ property: "og:title", content: "Deployment" },
			{ property: "og:type", content: "article" },
			{ property: "og:url", content: "https://docs.example/deployment" },
			{ name: "description", content: "Run Talqo on your infrastructure." },
			{ property: "og:description", content: "Run Talqo on your infrastructure." },
		])
			expect(head.meta).toContainEqual(tag)
	})

	test("uses the site title at the root and omits absent descriptions", () => {
		const head = docHead({
			title: "Welcome",
			url: "https://docs.example/",
			markdownUrl: "https://docs.example/index.md",
		})
		expect(head.meta).toContainEqual({ title: "Talqo Docs" })
		expect(head.meta).not.toContainEqual(expect.objectContaining({ name: "description" }))
		expect(head.meta).not.toContainEqual(expect.objectContaining({ property: "og:description" }))
	})

	test("does not publish metadata for a failed or incomplete load", () => {
		expect(docHead(undefined)).toEqual({})
	})
})
