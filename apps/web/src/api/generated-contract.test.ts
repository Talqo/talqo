import { GetSession200 } from "@/api/generated/models/identity/getSession200.zod.ts"
import { expect, it } from "bun:test"

it("accepts an anonymous session response", () => {
	expect(GetSession200.safeParse({ user: null }).success).toBe(true)
})
