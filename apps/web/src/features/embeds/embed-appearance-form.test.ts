import { describe, expect, test } from "bun:test"

import { embedFormSchema } from "./embed-appearance-form.ts"

describe("embedFormSchema", () => {
	test("rejects a whitespace-only name", () => {
		expect(embedFormSchema.shape.name.safeParse(" \t\n ").success).toBe(false)
	})
})
