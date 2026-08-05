import { z } from "zod"

const usernameSchema = z
	.string()
	.min(3)
	.max(32)
	.regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, numbers, underscores, and hyphens")

export const userResponseSchema = z.object({
	id: z.string(),
	username: z.string(),
})

export const signInRequestSchema = z.object({
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
	newPassword: z.string().min(8).max(128),
})
