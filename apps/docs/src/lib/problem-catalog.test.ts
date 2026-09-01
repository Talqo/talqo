import { describe, expect, it } from "bun:test"

import { PROBLEMS } from "./problem-catalog.ts"

const API_PROBLEM_CODES = [
	"admin-access-required",
	"admin-already-exists",
	"agent-invalid",
	"agent-name-taken",
	"agent-not-found",
	"authentication-required",
	"configuration-conflict",
	"current-password-incorrect",
	"internal-server-error",
	"invalid-ai-provider-configuration",
	"invalid-credentials",
	"invalid-invitation",
	"invalid-request",
	"malformed-json",
	"model-discovery-unsupported",
	"password-change-not-required",
	"password-change-required",
	"permission-denied",
	"provider-credentials-rejected",
	"provider-error",
	"provider-rate-limited",
	"provider-unreachable",
	"request-failed",
	"route-not-found",
	"self-password-reset-not-allowed",
	"user-not-found",
	"username-taken",
] as const

describe("problem catalog", () => {
	it("documents the API problem codes", () => {
		expect(PROBLEMS.map((problem) => problem.code).toSorted()).toEqual(API_PROBLEM_CODES.toSorted())
	})

	it("uses unique codes as stable anchors", () => {
		const codes = PROBLEMS.map((problem) => problem.code)

		expect(new Set(codes).size).toBe(codes.length)
		for (const code of codes) {
			expect(code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		}
	})
})
