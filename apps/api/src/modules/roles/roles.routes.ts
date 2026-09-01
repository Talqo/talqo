import type { AuthedVariables } from "@/http/require-auth.ts"

import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/pg-error.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import {
	accessResponseSchema,
	bootstrapAdminRoute,
	bootstrapAdminResponseSchema,
	createInvitationRoute,
	createInvitationResponseSchema,
	createPermissionGrantRoute,
	getAccessRoute,
	getSetupStatusRoute,
	getUsersRoute,
	grantResponseSchema,
	myPermissionsRoute,
	myPermissionsResponseSchema,
	redeemInvitationRoute,
	redeemInvitationResponseSchema,
	resetUserPasswordRoute,
	revokePermissionGrantRoute,
	setupStatusResponseSchema,
	userListResponseSchema,
} from "./roles.contract.ts"
import * as service from "./roles.service.ts"

export const rolesRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(getAccessRoute, async (c) => {
		return c.json(accessResponseSchema.parse(await service.getAccess(c.get("user").id)), HTTP_STATUS.OK)
	})
	.openapi(getSetupStatusRoute, async (c) => {
		const needsSetup = !(await service.hasAdmin())
		return c.json(setupStatusResponseSchema.parse({ needsSetup }), HTTP_STATUS.OK)
	})
	.openapi(bootstrapAdminRoute, async (c) => {
		try {
			const user = await service.bootstrapAdmin(c.req.valid("json"))
			return c.json(bootstrapAdminResponseSchema.parse({ user }), HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof service.AdminAlreadyExistsError) {
				return problemResponse(c, PROBLEM_CODES.ADMIN_ALREADY_EXISTS, HTTP_STATUS.CONFLICT)
			}
			if (isUniqueViolation(error)) return problemResponse(c, PROBLEM_CODES.USERNAME_TAKEN, HTTP_STATUS.CONFLICT)
			throw error
		}
	})

const invitationRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(createInvitationRoute, async (c) => {
		const user = c.get("user")
		if (!(await service.authorize(user.id, "users:invite"))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		const { token, expiresAt } = await service.createInvitation(user.id)
		return c.json(
			createInvitationResponseSchema.parse({ token, expiresAt: expiresAt.toISOString() }),
			HTTP_STATUS.CREATED,
		)
	})
	.openapi(redeemInvitationRoute, async (c) => {
		try {
			const user = await service.redeemInvitation(c.req.valid("json"))
			return c.json(redeemInvitationResponseSchema.parse({ user }), HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof service.InvalidInvitationError) {
				return problemResponse(c, PROBLEM_CODES.INVALID_INVITATION, HTTP_STATUS.CONFLICT)
			}
			if (isUniqueViolation(error)) return problemResponse(c, PROBLEM_CODES.USERNAME_TAKEN, HTTP_STATUS.CONFLICT)
			throw error
		}
	})

const permissionGrantRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(createPermissionGrantRoute, async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return problemResponse(c, PROBLEM_CODES.ADMIN_ACCESS_REQUIRED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const grant = await service.grantPermission({ ...c.req.valid("json"), grantedBy: user.id })
			return c.json(
				grantResponseSchema.parse({ grant: { ...grant, grantedAt: grant.grantedAt.toISOString() } }),
				HTTP_STATUS.CREATED,
			)
		} catch (error) {
			if (isForeignKeyViolation(error)) return problemResponse(c, PROBLEM_CODES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
			throw error
		}
	})
	.openapi(revokePermissionGrantRoute, async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return problemResponse(c, PROBLEM_CODES.ADMIN_ACCESS_REQUIRED, HTTP_STATUS.FORBIDDEN)
		}

		await service.revokePermission(c.req.valid("param").id)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

rolesRoutes.route("/invitations", invitationRoutes)
rolesRoutes.route("/permission-grants", permissionGrantRoutes)
// Dashboard reads this to hide routes and controls the caller cannot use.
rolesRoutes.openapi(myPermissionsRoute, async (c) => {
	const permissions = await service.listEffectivePermissions(c.get("user").id)
	return c.json(myPermissionsResponseSchema.parse({ permissions }), HTTP_STATUS.OK)
})

rolesRoutes.openapi(getUsersRoute, async (c) => {
	if (!(await service.isAdmin(c.get("user").id))) {
		return problemResponse(c, PROBLEM_CODES.ADMIN_ACCESS_REQUIRED, HTTP_STATUS.FORBIDDEN)
	}

	const users = await identity.listUsers()
	return c.json(userListResponseSchema.parse({ users }), HTTP_STATUS.OK)
})

rolesRoutes.openapi(resetUserPasswordRoute, async (c) => {
	const user = c.get("user")
	if (!(await service.isAdmin(user.id))) {
		return problemResponse(c, PROBLEM_CODES.ADMIN_ACCESS_REQUIRED, HTTP_STATUS.FORBIDDEN)
	}

	const targetUserId = c.req.valid("param").userId
	if (targetUserId === user.id) {
		return problemResponse(c, PROBLEM_CODES.SELF_PASSWORD_RESET_NOT_ALLOWED, HTTP_STATUS.BAD_REQUEST)
	}

	try {
		await identity.setPassword(targetUserId, c.req.valid("json").newPassword)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	} catch (error) {
		if (error instanceof identity.UserNotFoundError) {
			return problemResponse(c, PROBLEM_CODES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
		}
		throw error
	}
})
