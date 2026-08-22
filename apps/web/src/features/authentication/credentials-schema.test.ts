import { expect, test } from "bun:test"

import { invitationRegistrationFormSchema, registrationFormSchema } from "./credentials-schema.ts"

const username = "admin_user"
const password = "correct-horse-battery-staple"

test("registration schemas require matching password confirmation", () => {
	for (const schema of [registrationFormSchema, invitationRegistrationFormSchema]) {
		expect(schema.safeParse({ confirmPassword: "different-password", password, username }).success).toBe(false)
		expect(schema.safeParse({ confirmPassword: password, password, username }).success).toBe(true)
	}
})
