import type { ZodType } from "zod"

import { expect } from "bun:test"

export function expectValidationIssue(
	cases: ReadonlyArray<{ schema: ZodType; input: unknown }>,
	path: string,
	message: string,
): void {
	for (const { schema, input } of cases) {
		const result = schema.safeParse(input)
		expect(result.success).toBe(false)
		if (!result.success) {
			const issue = result.error.issues.find((entry) => entry.path.join(".") === path)
			expect(issue?.message).toBe(message)
		}
	}
}
