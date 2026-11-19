import { describe, expect, test } from "bun:test"

import { PROBLEMS, renderProblemsMarkdown } from "./problem-catalog"

describe("renderProblemsMarkdown", () => {
	test("includes every documented problem code and its guidance", () => {
		const markdown = renderProblemsMarkdown()

		for (const problem of PROBLEMS) {
			expect(markdown).toContain(`\`${problem.code}\``)
			expect(markdown).toContain(problem.guidance)
		}

		expect(markdown).toContain("/problems#")
	})

	test("covers every website lifecycle problem", () => {
		const websiteCodes = PROBLEMS.filter(({ code }) => code.startsWith("agent-website-")).map(({ code }) => code)
		expect(websiteCodes).toEqual([
			"agent-website-duplicate",
			"agent-website-invalid",
			"agent-website-not-found",
			"agent-website-not-refreshable",
		])
	})

	test("renders each problem as one titled section", () => {
		const markdown = renderProblemsMarkdown()
		const sample = PROBLEMS[0]!

		expect(markdown).toContain(
			`## ${sample.title}\n\n\`${sample.status}\` · \`${sample.code}\`\n\n${sample.meaning}\n\n**Fix:** ${sample.guidance}`,
		)
	})
})
