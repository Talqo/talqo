import type { AuthedVariables } from "@/http/require-auth.ts"

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
	grantResponseSchema,
	redeemInvitationRoute,
	redeemInvitationResponseSchema,
	resetUserPasswordRoute,
	revokePermissionGrantRoute,
	setupStatusResponseSchema,
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
				return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
			}
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, HTTP_STATUS.CONFLICT)
			throw error
		}
	})

const invitationRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(createInvitationRoute, async (c) => {
		const user = c.get("user")
		if (!(await service.authorize(user.id, "users:invite"))) {
			return c.json({ error: "Missing users:invite permission" }, HTTP_STATUS.FORBIDDEN)
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
				return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
			}
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, HTTP_STATUS.CONFLICT)
			throw error
		}
	})

const permissionGrantRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(createPermissionGrantRoute, async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return c.json({ error: "Admin access required" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const grant = await service.grantPermission({ ...c.req.valid("json"), grantedBy: user.id })
			return c.json(
				grantResponseSchema.parse({ grant: { ...grant, grantedAt: grant.grantedAt.toISOString() } }),
				HTTP_STATUS.CREATED,
			)
		} catch (error) {
			if (isForeignKeyViolation(error)) return c.json({ error: "User not found" }, HTTP_STATUS.NOT_FOUND)
			throw error
		}
	})
	.openapi(revokePermissionGrantRoute, async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return c.json({ error: "Admin access required" }, HTTP_STATUS.FORBIDDEN)
		}

		await service.revokePermission(c.req.valid("param").id)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

rolesRoutes.route("/invitations", invitationRoutes)
rolesRoutes.route("/permission-grants", permissionGrantRoutes)
rolesRoutes.openapi(resetUserPasswordRoute, async (c) => {
	const user = c.get("user")
	if (!(await service.isAdmin(user.id))) {
		return c.json({ error: "Admin access required" }, HTTP_STATUS.FORBIDDEN)
	}

	try {
		await identity.setPassword(c.req.valid("param").userId, c.req.valid("json").newPassword)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	} catch (error) {
		if (error instanceof identity.UserNotFoundError) {
			return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
		}
		throw error
	}
})
