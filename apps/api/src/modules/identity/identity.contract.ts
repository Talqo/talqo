import { noContentResponse, problemResponse, sessionSecurity } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { createRoute, z } from "@hono/zod-openapi"

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

export const userResponseSchema = z
	.object({
		id: z.string(),
		username: z.string(),
		mustChangePassword: z.boolean(),
	})
	.openapi("User")

export const loginRequestSchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1),
})

export const sessionResponseSchema = z.object({
	user: z.union([userResponseSchema, z.null()]),
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

const userEnvelopeSchema = z.object({ user: userResponseSchema })

const malformedJson = problemResponse([PROBLEM_CODES.MALFORMED_JSON])
const invalidRequest = problemResponse([PROBLEM_CODES.INVALID_REQUEST, PROBLEM_CODES.MALFORMED_JSON])
const authRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const passwordRequired = problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])

export const loginRoute = createRoute({
	method: "post",
	path: "/login",
	operationId: "login",
	tags: ["Identity"],
	request: {
		body: { content: { "application/json": { schema: loginRequestSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: userEnvelopeSchema } }, description: "Authenticated user" },
		400: invalidRequest,
		401: problemResponse([PROBLEM_CODES.INVALID_CREDENTIALS]),
		500: serverError,
	},
})

export const logoutRoute = createRoute({
	method: "post",
	path: "/logout",
	operationId: "logout",
	tags: ["Identity"],
	responses: {
		204: noContentResponse,
		400: malformedJson,
		500: serverError,
	},
})

export const getSessionRoute = createRoute({
	method: "get",
	path: "/session",
	operationId: "getSession",
	tags: ["Identity"],
	responses: {
		200: { content: { "application/json": { schema: sessionResponseSchema } }, description: "Current session" },
		400: malformedJson,
		500: serverError,
	},
})

export const updateAccountRoute = createRoute({
	method: "patch",
	path: "/",
	operationId: "updateAccount",
	tags: ["Identity"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: updateAccountRequestSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: userEnvelopeSchema } }, description: "Updated user" },
		400: invalidRequest,
		401: authRequired,
		403: passwordRequired,
		409: problemResponse([PROBLEM_CODES.USERNAME_TAKEN]),
		500: serverError,
	},
})

export const changePasswordRoute = createRoute({
	method: "patch",
	path: "/password",
	operationId: "changePassword",
	tags: ["Identity"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: changePasswordRequestSchema } }, required: true },
	},
	responses: {
		204: noContentResponse,
		400: problemResponse([
			PROBLEM_CODES.CURRENT_PASSWORD_INCORRECT,
			PROBLEM_CODES.INVALID_REQUEST,
			PROBLEM_CODES.MALFORMED_JSON,
		]),
		401: authRequired,
		500: serverError,
	},
})

export const completeForcedPasswordChangeRoute = createRoute({
	method: "patch",
	path: "/password/forced",
	operationId: "completeForcedPasswordChange",
	tags: ["Identity"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: forcedPasswordChangeRequestSchema } }, required: true },
	},
	responses: {
		204: noContentResponse,
		400: invalidRequest,
		401: authRequired,
		409: problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_NOT_REQUIRED]),
		500: serverError,
	},
})

export const deleteAccountRoute = createRoute({
	method: "delete",
	path: "/",
	operationId: "deleteAccount",
	tags: ["Identity"],
	security: sessionSecurity,
	responses: {
		204: noContentResponse,
		400: malformedJson,
		401: authRequired,
		403: passwordRequired,
		500: serverError,
	},
})
