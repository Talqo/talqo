import { z } from "zod"

import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "./identity.service.ts"

const usernameSchema = z
	.string()
	.min(USERNAME_MIN_LENGTH)
	.max(USERNAME_MAX_LENGTH)
	.regex(USERNAME_PATTERN, "Username may only contain letters, numbers, underscores, and hyphens")

export const userResponseSchema = z.object({
	id: z.string(),
	username: z.string(),
	mustChangePassword: z.boolean(),
})

export const loginRequestSchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1),
})

export const sessionResponseSchema = z.object({
	user: userResponseSchema.nullable(),
})

export const updateAccountRequestSchema = z.object({
	username: usernameSchema,
})

export const changePasswordRequestSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

export const forcedPasswordChangeRequestSchema = z.object({
	newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})
