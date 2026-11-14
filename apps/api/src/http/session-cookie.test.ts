import { env } from "@/config/env.ts"
import { describe, expect, it } from "bun:test"

import { sessionCookieOptions } from "./session-cookie.ts"

function optionsFor(nodeEnv: "development" | "production") {
	const descriptor = Object.getOwnPropertyDescriptor(env, "NODE_ENV")
	if (!descriptor) throw new Error("Expected the NODE_ENV configuration")
	Object.defineProperty(env, "NODE_ENV", { ...descriptor, get: () => nodeEnv })
	try {
		return sessionCookieOptions()
	} finally {
		Object.defineProperty(env, "NODE_ENV", descriptor)
	}
}

describe("session cookie options", () => {
	it("scopes the cookie to the whole origin and hides it from scripts", () => {
		expect(optionsFor("development")).toEqual({
			httpOnly: true,
			sameSite: "Lax",
			secure: false,
			path: "/",
		})
	})

	it("requires HTTPS only in production", () => {
		expect(optionsFor("production").secure).toBe(true)
		expect(optionsFor("development").secure).toBe(false)
	})
})
