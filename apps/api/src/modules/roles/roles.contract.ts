import { access } from "@/http/access.ts"
import { noContentResponse, payloadTooLargeResponse, problemResponse } from "@/http/openapi.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { userResponseSchema } from "@/modules/identity/identity.contract.ts"
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "@/modules/identity/identity.service.ts"
import { createRoute, z } from "@hono/zod-openapi"
import { CREDENTIAL_MAX_LENGTH } from "@talqo/shared"

import {
	AGENT_PERMISSIONS,
	GRANTABLE_PERMISSIONS,
	Permission,
	PERMISSIONS,
	ROLE_IDS_MAX,
	ROLE_NAME_MAX_LENGTH,
} from "./roles.service.ts"

const usernameSchema = z
	.string()
	.min(USERNAME_MIN_LENGTH)
	.max(USERNAME_MAX_LENGTH)
	.regex(USERNAME_PATTERN, "Username may only contain letters, numbers, underscores, and hyphens")

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

export const setupStatusResponseSchema = z.object({
	needsSetup: z.boolean(),
})

const bootstrapAdminRequestSchema = z.object({
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

const redeemInvitationRequestSchema = z.object({
	token: z.string().min(1).max(CREDENTIAL_MAX_LENGTH),
	username: usernameSchema,
	password: passwordSchema,
})

export const redeemInvitationResponseSchema = z.object({
	user: userResponseSchema,
})

export const myPermissionsResponseSchema = z.object({
	permissions: z.array(z.enum(PERMISSIONS)),
})

const roleSummarySchema = z.object({ id: z.string(), name: z.string() }).openapi("RoleSummary")

const roleSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		permissions: z.array(z.enum(GRANTABLE_PERMISSIONS)),
		memberCount: z.number().int(),
	})
	.openapi("Role")

function hasNoRepeats(values: string[]): boolean {
	return new Set(values).size === values.length
}

const roleRequestSchema = z
	.object({
		name: z.string().trim().min(1).max(ROLE_NAME_MAX_LENGTH),
		permissions: z
			.array(z.enum(GRANTABLE_PERMISSIONS))
			.max(GRANTABLE_PERMISSIONS.length)
			.refine(hasNoRepeats, { message: "Permissions must not repeat" }),
	})
	.strict()

const assignRolesRequestSchema = z
	.object({
		roleIds: z
			.array(z.string().min(1).max(CREDENTIAL_MAX_LENGTH))
			.max(ROLE_IDS_MAX)
			.refine(hasNoRepeats, { message: "Role ids must not repeat" }),
	})
	.strict()

export const grantablePermissionsResponseSchema = z.object({
	permissions: z.array(
		z.object({ permission: z.enum(GRANTABLE_PERMISSIONS), implies: z.array(z.enum(GRANTABLE_PERMISSIONS)) }),
	),
})

export const roleListResponseSchema = z.object({ roles: z.array(roleSchema), manageableRoleIds: z.array(z.string()) })
export const roleResponseSchema = z.object({ role: roleSchema })
export const userRolesResponseSchema = z.object({ roles: z.array(roleSummarySchema) })

const invalidRequest = problemResponse([PROBLEM_CODES.INVALID_REQUEST, PROBLEM_CODES.MALFORMED_JSON])
const authRequired = problemResponse([PROBLEM_CODES.AUTHENTICATION_REQUIRED])
const passwordRequired = problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED])
const permissionForbidden = problemResponse([PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED, PROBLEM_CODES.PERMISSION_DENIED])
const targetForbidden = problemResponse([
	PROBLEM_CODES.PASSWORD_CHANGE_REQUIRED,
	PROBLEM_CODES.PERMISSION_DENIED,
	PROBLEM_CODES.PERMISSION_EXCEEDS_OWN,
])
const userNotFound = problemResponse([PROBLEM_CODES.USER_NOT_FOUND])
const roleNotFound = problemResponse([PROBLEM_CODES.ROLE_NOT_FOUND])
const serverError = problemResponse([PROBLEM_CODES.INTERNAL_SERVER_ERROR])

export const myPermissionsRoute = createRoute({
	method: "get",
	path: "/me/permissions",
	operationId: "getMyPermissions",
	tags: ["Roles"],
	...access.session(),
	responses: {
		200: {
			content: { "application/json": { schema: myPermissionsResponseSchema } },
			description: "Effective permissions",
		},
		401: authRequired,
		403: passwordRequired,
		500: serverError,
	},
})

export const myRolesRoute = createRoute({
	method: "get",
	path: "/me/roles",
	operationId: "getMyRoles",
	tags: ["Roles"],
	...access.session(),
	responses: {
		200: {
			content: { "application/json": { schema: userRolesResponseSchema } },
			description: "Roles assigned to the current operator",
		},
		401: authRequired,
		403: passwordRequired,
		500: serverError,
	},
})

const resetPasswordRequestSchema = z.object({
	newPassword: passwordSchema,
})

export const userListResponseSchema = z.object({
	users: z.array(
		z.object({
			...userResponseSchema.shape,
			permissions: z.array(z.enum(PERMISSIONS)),
			canManage: z.boolean(),
			mustChangePassword: userResponseSchema.shape.mustChangePassword.nullable(),
			roles: z.array(roleSummarySchema),
		}),
	),
})

const userParamsSchema = z.object({
	userId: z.string().openapi({ param: { name: "userId", in: "path" } }),
})

const roleParamsSchema = z.object({
	roleId: z.string().openapi({ param: { name: "roleId", in: "path" } }),
})

const agentAccessParamsSchema = z.object({ agentId: z.string().min(1) })
const agentRoleParamsSchema = agentAccessParamsSchema.extend({ roleId: z.string().min(1) })
const agentPermissionsResponseSchema = z.object({ permissions: z.array(z.enum(AGENT_PERMISSIONS)) })
export const agentAccessResponseSchema = z.object({
	permissions: z.array(z.enum(AGENT_PERMISSIONS)),
	roles: z.array(roleSummarySchema.extend({ permissions: z.array(z.enum(AGENT_PERMISSIONS)) })).optional(),
})

export const getAgentAccessRoute = createRoute({
	method: "get",
	path: "/agents/{agentId}/access",
	operationId: "getAgentAccess",
	tags: ["Roles"],
	...access.session(),
	request: { params: agentAccessParamsSchema },
	responses: {
		200: {
			content: { "application/json": { schema: agentAccessResponseSchema } },
			description: "Effective permissions, with role grants for access managers",
		},
		401: authRequired,
		403: permissionForbidden,
		404: problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND]),
		500: serverError,
	},
})

export const setAgentAccessRoute = createRoute({
	method: "put",
	path: "/agents/{agentId}/access/{roleId}",
	operationId: "setAgentAccess",
	tags: ["Roles"],
	...access.permission(Permission.RolesManage),
	request: {
		params: agentRoleParamsSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: agentPermissionsResponseSchema
						.strict()
						.refine(({ permissions }) => permissions.length > 0 && hasNoRepeats(permissions)),
				},
			},
		},
	},
	responses: {
		204: noContentResponse,
		400: invalidRequest,
		401: authRequired,
		403: targetForbidden,
		404: problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND, PROBLEM_CODES.ROLE_NOT_FOUND]),
		500: serverError,
	},
})

export const removeAgentAccessRoute = createRoute({
	method: "delete",
	path: "/agents/{agentId}/access/{roleId}",
	operationId: "removeAgentAccess",
	tags: ["Roles"],
	...access.permission(Permission.RolesManage),
	request: { params: agentRoleParamsSchema },
	responses: {
		204: noContentResponse,
		401: authRequired,
		403: targetForbidden,
		404: problemResponse([PROBLEM_CODES.AGENT_NOT_FOUND, PROBLEM_CODES.ROLE_NOT_FOUND]),
		500: serverError,
	},
})

export const getSetupStatusRoute = createRoute({
	method: "get",
	path: "/setup",
	operationId: "getSetupStatus",
	tags: ["Roles"],
	...access.public,
	responses: {
		200: { content: { "application/json": { schema: setupStatusResponseSchema } }, description: "Setup status" },
		500: serverError,
	},
})

export const bootstrapAdminRoute = createRoute({
	method: "post",
	path: "/setup",
	operationId: "bootstrapAdmin",
	tags: ["Roles"],
	...access.public,
	request: {
		body: { content: { "application/json": { schema: bootstrapAdminRequestSchema } }, required: true },
	},
	responses: {
		201: {
			content: { "application/json": { schema: bootstrapAdminResponseSchema } },
			description: "Admin created",
		},
		400: invalidRequest,
		409: problemResponse([PROBLEM_CODES.ADMIN_ALREADY_EXISTS, PROBLEM_CODES.USERNAME_TAKEN]),
		429: problemResponse([PROBLEM_CODES.AUTH_RATE_LIMITED]),
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const createInvitationRoute = createRoute({
	method: "post",
	path: "/",
	operationId: "createInvitation",
	tags: ["Roles"],
	...access.permission(Permission.UsersManage),
	request: {
		body: { content: { "application/json": { schema: assignRolesRequestSchema.optional() } }, required: false },
	},
	responses: {
		201: {
			content: { "application/json": { schema: createInvitationResponseSchema } },
			description: "Invitation created",
		},
		401: authRequired,
		400: invalidRequest,
		403: targetForbidden,
		404: roleNotFound,
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const redeemInvitationRoute = createRoute({
	method: "post",
	path: "/redeem",
	operationId: "redeemInvitation",
	tags: ["Roles"],
	...access.public,
	request: {
		body: { content: { "application/json": { schema: redeemInvitationRequestSchema } }, required: true },
	},
	responses: {
		201: {
			content: { "application/json": { schema: redeemInvitationResponseSchema } },
			description: "Invitation redeemed",
		},
		400: invalidRequest,
		409: problemResponse([PROBLEM_CODES.INVALID_INVITATION, PROBLEM_CODES.USERNAME_TAKEN]),
		429: problemResponse([PROBLEM_CODES.AUTH_RATE_LIMITED]),
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const getUsersRoute = createRoute({
	method: "get",
	path: "/",
	operationId: "listUsers",
	tags: ["Roles"],
	...access.permission(Permission.UsersRead),
	responses: {
		200: {
			content: { "application/json": { schema: userListResponseSchema } },
			description: "Users with their roles and available management actions",
		},
		401: authRequired,
		403: permissionForbidden,
		500: serverError,
	},
})

export const deleteUserRoute = createRoute({
	method: "delete",
	path: "/{userId}",
	operationId: "deleteUser",
	tags: ["Roles"],
	...access.permission(Permission.UsersManage),
	request: { params: userParamsSchema },
	responses: {
		204: noContentResponse,
		400: problemResponse([PROBLEM_CODES.SELF_DELETE_NOT_ALLOWED]),
		401: authRequired,
		403: targetForbidden,
		404: userNotFound,
		500: serverError,
	},
})

export const resetUserPasswordRoute = createRoute({
	method: "patch",
	path: "/{userId}/password",
	operationId: "resetUserPassword",
	tags: ["Roles"],
	...access.permission(Permission.UsersManage),
	request: {
		params: userParamsSchema,
		body: { content: { "application/json": { schema: resetPasswordRequestSchema } }, required: true },
	},
	responses: {
		204: noContentResponse,
		400: problemResponse([
			PROBLEM_CODES.INVALID_REQUEST,
			PROBLEM_CODES.MALFORMED_JSON,
			PROBLEM_CODES.SELF_PASSWORD_RESET_NOT_ALLOWED,
		]),
		401: authRequired,
		403: targetForbidden,
		404: userNotFound,
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const listGrantablePermissionsRoute = createRoute({
	method: "get",
	path: "/permissions",
	operationId: "listGrantablePermissions",
	tags: ["Roles"],
	...access.permission(Permission.RolesManage),
	responses: {
		200: {
			content: { "application/json": { schema: grantablePermissionsResponseSchema } },
			description: "Permissions a role may hold, with what each implies",
		},
		401: authRequired,
		403: permissionForbidden,
		500: serverError,
	},
})

export const listRolesRoute = createRoute({
	method: "get",
	path: "/roles",
	operationId: "listRoles",
	tags: ["Roles"],
	...access.permission(Permission.RolesManage),
	responses: {
		200: { content: { "application/json": { schema: roleListResponseSchema } }, description: "All roles" },
		401: authRequired,
		403: permissionForbidden,
		500: serverError,
	},
})

export const createRoleRoute = createRoute({
	method: "post",
	path: "/roles",
	operationId: "createRole",
	tags: ["Roles"],
	...access.permission(Permission.RolesManage),
	request: {
		body: { content: { "application/json": { schema: roleRequestSchema } }, required: true },
	},
	responses: {
		201: { content: { "application/json": { schema: roleResponseSchema } }, description: "Role created" },
		400: invalidRequest,
		401: authRequired,
		403: targetForbidden,
		409: problemResponse([PROBLEM_CODES.ROLE_NAME_TAKEN]),
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const updateRoleRoute = createRoute({
	method: "put",
	path: "/roles/{roleId}",
	operationId: "updateRole",
	tags: ["Roles"],
	...access.permission(Permission.RolesManage),
	request: {
		params: roleParamsSchema,
		body: { content: { "application/json": { schema: roleRequestSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: roleResponseSchema } }, description: "Role updated" },
		400: invalidRequest,
		401: authRequired,
		403: targetForbidden,
		404: roleNotFound,
		409: problemResponse([PROBLEM_CODES.ROLE_NAME_TAKEN]),
		413: payloadTooLargeResponse,
		500: serverError,
	},
})

export const deleteRoleRoute = createRoute({
	method: "delete",
	path: "/roles/{roleId}",
	operationId: "deleteRole",
	tags: ["Roles"],
	...access.permission(Permission.RolesManage),
	request: { params: roleParamsSchema },
	responses: {
		204: noContentResponse,
		401: authRequired,
		403: targetForbidden,
		404: roleNotFound,
		409: problemResponse([PROBLEM_CODES.DEFAULT_ROLE_DELETE_NOT_ALLOWED]),
		500: serverError,
	},
})

export const assignUserRolesRoute = createRoute({
	method: "put",
	path: "/users/{userId}/roles",
	operationId: "assignUserRoles",
	tags: ["Roles"],
	...access.permission(Permission.RolesManage),
	request: {
		params: userParamsSchema,
		body: { content: { "application/json": { schema: assignRolesRequestSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: userRolesResponseSchema } }, description: "The user's roles" },
		400: invalidRequest,
		401: authRequired,
		403: targetForbidden,
		404: problemResponse([PROBLEM_CODES.ROLE_NOT_FOUND, PROBLEM_CODES.USER_NOT_FOUND]),
		413: payloadTooLargeResponse,
		500: serverError,
	},
})
