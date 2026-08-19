import {
	badRequestResponse,
	conflictResponse,
	forbiddenResponse,
	internalServerErrorResponse,
	noContentResponse,
	notFoundResponse,
	sessionSecurity,
	unauthorizedResponse,
} from "@/http/openapi.ts"
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "@/modules/identity/identity.service.ts"
import { createRoute, z } from "@hono/zod-openapi"

import { PERMISSIONS } from "./roles.service.ts"

const usernameSchema = z
	.string()
	.min(USERNAME_MIN_LENGTH)
	.max(USERNAME_MAX_LENGTH)
	.regex(USERNAME_PATTERN, "Username may only contain letters, numbers, underscores, and hyphens")

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

// Mirrors identity.contract.ts's userResponseSchema: cross-module imports are service.ts-only here.
const userResponseSchema = z
	.object({
		id: z.string(),
		username: z.string(),
		mustChangePassword: z.boolean(),
	})
	.openapi("RoleUser")

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
	expiresAt: z.iso.datetime(),
})

export const redeemInvitationRequestSchema = z.object({
	token: z.string().min(1),
	username: usernameSchema,
	password: passwordSchema,
})

export const redeemInvitationResponseSchema = z.object({
	user: userResponseSchema,
})

export const createGrantRequestSchema = z
	.object({
		userId: z.string().min(1),
		permission: z.enum(PERMISSIONS),
	})
	.strict()

export const grantResponseSchema = z.object({
	grant: z.object({
		id: z.string(),
		userId: z.string(),
		permission: z.string(),
		grantedBy: z.string().nullable(),
		grantedAt: z.iso.datetime(),
	}),
})

export const myPermissionsResponseSchema = z.object({
	permissions: z.array(z.enum(PERMISSIONS)),
})

export const myPermissionsRoute = createRoute({
	method: "get",
	path: "/me/permissions",
	operationId: "getMyPermissions",
	tags: ["Roles"],
	security: sessionSecurity,
	responses: {
		200: {
			content: { "application/json": { schema: myPermissionsResponseSchema } },
			description: "Effective permissions",
		},
		401: unauthorizedResponse,
		500: internalServerErrorResponse,
	},
})

export const resetPasswordRequestSchema = z.object({
	newPassword: passwordSchema,
})

export const userListResponseSchema = z.object({
	users: z.array(userResponseSchema),
})

export const accessResponseSchema = z.object({
	isAdmin: z.boolean(),
	permissions: z.array(z.enum(PERMISSIONS)),
})

const permissionGrantParamsSchema = z.object({
	id: z.string().openapi({ param: { name: "id", in: "path" } }),
})

const userParamsSchema = z.object({
	userId: z.string().openapi({ param: { name: "userId", in: "path" } }),
})

export const getAccessRoute = createRoute({
	method: "get",
	path: "/access",
	operationId: "getAccess",
	tags: ["Roles"],
	security: sessionSecurity,
	responses: {
		200: {
			content: { "application/json": { schema: accessResponseSchema } },
			description: "Effective access for the current user",
		},
		401: unauthorizedResponse,
		500: internalServerErrorResponse,
	},
})

export const getSetupStatusRoute = createRoute({
	method: "get",
	path: "/setup",
	operationId: "getSetupStatus",
	tags: ["Roles"],
	responses: {
		200: { content: { "application/json": { schema: setupStatusResponseSchema } }, description: "Setup status" },
		500: internalServerErrorResponse,
	},
})

export const bootstrapAdminRoute = createRoute({
	method: "post",
	path: "/setup",
	operationId: "bootstrapAdmin",
	tags: ["Roles"],
	request: {
		body: { content: { "application/json": { schema: bootstrapAdminRequestSchema } }, required: true },
	},
	responses: {
		201: {
			content: { "application/json": { schema: bootstrapAdminResponseSchema } },
			description: "Admin created",
		},
		400: badRequestResponse,
		409: conflictResponse,
		500: internalServerErrorResponse,
	},
})

export const createInvitationRoute = createRoute({
	method: "post",
	path: "/",
	operationId: "createInvitation",
	tags: ["Roles"],
	security: sessionSecurity,
	responses: {
		201: {
			content: { "application/json": { schema: createInvitationResponseSchema } },
			description: "Invitation created",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		500: internalServerErrorResponse,
	},
})

export const redeemInvitationRoute = createRoute({
	method: "post",
	path: "/redeem",
	operationId: "redeemInvitation",
	tags: ["Roles"],
	request: {
		body: { content: { "application/json": { schema: redeemInvitationRequestSchema } }, required: true },
	},
	responses: {
		201: {
			content: { "application/json": { schema: redeemInvitationResponseSchema } },
			description: "Invitation redeemed",
		},
		400: badRequestResponse,
		409: conflictResponse,
		500: internalServerErrorResponse,
	},
})

export const createPermissionGrantRoute = createRoute({
	method: "post",
	path: "/",
	operationId: "createPermissionGrant",
	tags: ["Roles"],
	security: sessionSecurity,
	request: {
		body: { content: { "application/json": { schema: createGrantRequestSchema } }, required: true },
	},
	responses: {
		201: { content: { "application/json": { schema: grantResponseSchema } }, description: "Permission granted" },
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})

export const revokePermissionGrantRoute = createRoute({
	method: "delete",
	path: "/{id}",
	operationId: "revokePermissionGrant",
	tags: ["Roles"],
	security: sessionSecurity,
	request: { params: permissionGrantParamsSchema },
	responses: {
		204: noContentResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		500: internalServerErrorResponse,
	},
})

export const getUsersRoute = createRoute({
	method: "get",
	path: "/users",
	operationId: "listUsers",
	tags: ["Roles"],
	security: sessionSecurity,
	responses: {
		200: { content: { "application/json": { schema: userListResponseSchema } }, description: "All users" },
		401: unauthorizedResponse,
		403: forbiddenResponse,
		500: internalServerErrorResponse,
	},
})

export const resetUserPasswordRoute = createRoute({
	method: "patch",
	path: "/users/{userId}/password",
	operationId: "resetUserPassword",
	tags: ["Roles"],
	security: sessionSecurity,
	request: {
		params: userParamsSchema,
		body: { content: { "application/json": { schema: resetPasswordRequestSchema } }, required: true },
	},
	responses: {
		204: noContentResponse,
		400: badRequestResponse,
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: notFoundResponse,
		500: internalServerErrorResponse,
	},
})
