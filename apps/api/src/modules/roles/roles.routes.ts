import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { sessionCookieOptions } from "@/http/session-cookie.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { setCookie } from "hono/cookie"

import {
	accessResponseSchema,
	bootstrapAdminRoute,
	bootstrapAdminResponseSchema,
	createInvitationRoute,
	createInvitationResponseSchema,
	createPermissionGrantRoute,
	deleteUserRoute,
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

export const rolesRoutes = new OpenAPIHono()
	.openapi(getAccessRoute, async (c) => {
		return c.json(accessResponseSchema.parse(await service.getAccess(c.get("user").id)), HTTP_STATUS.OK)
	})
	.openapi(getSetupStatusRoute, async (c) => {
		const needsSetup = !(await service.hasAdmin())
		return c.json(setupStatusResponseSchema.parse({ needsSetup }), HTTP_STATUS.OK)
	})
	.openapi(bootstrapAdminRoute, async (c) => {
		const user = await service.bootstrapAdmin(c.req.valid("json"))
		// Set the session now: the setup page lands signed in without a second login round-trip.
		const { token, expiresAt } = await identity.createSession(user.id)
		setCookie(c, identity.SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt })
		return c.json(bootstrapAdminResponseSchema.parse({ user }), HTTP_STATUS.CREATED)
	})

const invitationRoutes = new OpenAPIHono()
	.openapi(createInvitationRoute, async (c) => {
		const user = c.get("user")
		const { token, expiresAt } = await service.createInvitation(user.id)
		return c.json(
			createInvitationResponseSchema.parse({ token, expiresAt: expiresAt.toISOString() }),
			HTTP_STATUS.CREATED,
		)
	})
	.openapi(redeemInvitationRoute, async (c) => {
		const user = await service.redeemInvitation(c.req.valid("json"))
		// Set the session now: accepting an invitation lands the member signed in.
		const { token, expiresAt } = await identity.createSession(user.id)
		setCookie(c, identity.SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt })
		return c.json(redeemInvitationResponseSchema.parse({ user }), HTTP_STATUS.CREATED)
	})

const permissionGrantRoutes = new OpenAPIHono()
	.openapi(createPermissionGrantRoute, async (c) => {
		const user = c.get("user")
		const grant = await service.grantPermission({ ...c.req.valid("json"), grantedBy: user.id })
		return c.json(
			grantResponseSchema.parse({ grant: { ...grant, grantedAt: grant.grantedAt.toISOString() } }),
			HTTP_STATUS.CREATED,
		)
	})
	.openapi(revokePermissionGrantRoute, async (c) => {
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

const userRoutes = new OpenAPIHono()
	.openapi(getUsersRoute, async (c) => {
		const users = await identity.listUsers()
		return c.json(userListResponseSchema.parse({ users }), HTTP_STATUS.OK)
	})
	.openapi(resetUserPasswordRoute, async (c) => {
		const user = c.get("user")
		const targetUserId = c.req.valid("param").userId
		if (targetUserId === user.id) {
			return problemResponse(c, PROBLEM_CODES.SELF_PASSWORD_RESET_NOT_ALLOWED, HTTP_STATUS.BAD_REQUEST)
		}

		await identity.setPassword(targetUserId, c.req.valid("json").newPassword)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(deleteUserRoute, async (c) => {
		const user = c.get("user")
		const targetUserId = c.req.valid("param").userId
		if (targetUserId === user.id) {
			return problemResponse(c, PROBLEM_CODES.SELF_DELETE_NOT_ALLOWED, HTTP_STATUS.BAD_REQUEST)
		}

		await identity.deleteAccount(targetUserId)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

rolesRoutes.route("/users", userRoutes)
