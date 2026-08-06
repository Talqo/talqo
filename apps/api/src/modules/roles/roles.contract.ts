import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "@/modules/identity/identity.service.ts"
import { z } from "zod"

export const setupStatusResponseSchema = z.object({
	needsSetup: z.boolean(),
})

export const bootstrapAdminRequestSchema = z.object({
	username: z
		.string()
		.min(USERNAME_MIN_LENGTH)
		.max(USERNAME_MAX_LENGTH)
		.regex(USERNAME_PATTERN, "Username may only contain letters, numbers, underscores, and hyphens"),
	password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

export const bootstrapAdminResponseSchema = z.object({
	user: z.object({
		id: z.string(),
		username: z.string(),
	}),
})
