import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "@/modules/identity/identity.service.ts"
import { z } from "zod"

const usernameSchema = z
	.string()
	.min(USERNAME_MIN_LENGTH)
	.max(USERNAME_MAX_LENGTH)
	.regex(USERNAME_PATTERN, "Username may only contain letters, numbers, underscores, and hyphens")

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

const userResponseSchema = z.object({
	id: z.string(),
	username: z.string(),
})

export const setupStatusResponseSchema = z.object({
	needsSetup: z.boolean(),
})

export const bootstrapAdminRequestSchema = z.object({
	username: usernameSchema,
	password: passwordSchema,
})

export const bootstrapAdminResponseSchema = z.object({
	user: userResponseSchema,
})

export const createInvitationResponseSchema = z.object({
	token: z.string(),
	expiresAt: z.date(),
})

export const redeemInvitationRequestSchema = z.object({
	token: z.string().min(1),
	username: usernameSchema,
	password: passwordSchema,
})

export const redeemInvitationResponseSchema = z.object({
	user: userResponseSchema,
})
