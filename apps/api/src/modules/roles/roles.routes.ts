import { requestClientNetwork } from "@/http/client-network.ts"
import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
import { sessionCookieOptions } from "@/http/session-cookie.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { annotate } from "@/http/wide-event.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"
import { setCookie } from "hono/cookie"

import {
	agentAccessResponseSchema,
	assignUserRolesRoute,
	bootstrapAdminResponseSchema,
	bootstrapAdminRoute,
	createInvitationResponseSchema,
	createInvitationRoute,
	createRoleRoute,
	deleteRoleRoute,
	deleteUserRoute,
	getAgentAccessRoute,
	getSetupStatusRoute,
	getUsersRoute,
	grantablePermissionsResponseSchema,
	listGrantablePermissionsRoute,
	listRolesRoute,
	myPermissionsResponseSchema,
	myPermissionsRoute,
	myRolesRoute,
	redeemInvitationResponseSchema,
	redeemInvitationRoute,
	removeAgentAccessRoute,
	resetUserPasswordRoute,
	roleListResponseSchema,
	roleResponseSchema,
	setAgentAccessRoute,
	setupStatusResponseSchema,
	updateRoleRoute,
	userListResponseSchema,
	userRolesResponseSchema,
} from "./roles.contract.ts"
import * as service from "./roles.service.ts"

export const rolesRoutes = new OpenAPIHono()
	.openapi(getAgentAccessRoute, async (c) => {
		return c.json(
			agentAccessResponseSchema.parse(await service.listAgentAccess(c.get("user").id, c.req.valid("param").agentId)),
			HTTP_STATUS.OK,
		)
	})
	.openapi(setAgentAccessRoute, async (c) => {
		const { agentId, roleId } = c.req.valid("param")
		await service.setAgentAccess(c.get("user").id, agentId, roleId, c.req.valid("json").permissions)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(removeAgentAccessRoute, async (c) => {
		const { agentId, roleId } = c.req.valid("param")
		await service.setAgentAccess(c.get("user").id, agentId, roleId, [])
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(getSetupStatusRoute, async (c) => {
		const needsSetup = !(await service.hasAdmin())
		return c.json(setupStatusResponseSchema.parse({ needsSetup }), HTTP_STATUS.OK)
	})
	.openapi(bootstrapAdminRoute, async (c) => {
		const input = c.req.valid("json")
		const user = await identity.runCredentialOperation(requestClientNetwork(c), input.username, () =>
			service.bootstrapAdmin(input),
		)
		annotate(c, { "user.id": user.id })
		// Set the session now: the setup page lands signed in without a second login round-trip.
		const { token, expiresAt } = await identity.createSession(user.id)
		setCookie(c, identity.SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt })
		return c.json(bootstrapAdminResponseSchema.parse({ user }), HTTP_STATUS.CREATED)
	})

const invitationRoutes = new OpenAPIHono()
	.openapi(createInvitationRoute, async (c) => {
		const user = c.get("user")
		const { token, expiresAt } = await service.createInvitation(user.id, c.req.valid("json")?.roleIds ?? [])
		return c.json(
			createInvitationResponseSchema.parse({ token, expiresAt: expiresAt.toISOString() }),
			HTTP_STATUS.CREATED,
		)
	})
	.openapi(redeemInvitationRoute, async (c) => {
		const input = c.req.valid("json")
		const user = await identity.runCredentialOperation(requestClientNetwork(c), input.username, () =>
			service.redeemInvitation(input),
		)
		annotate(c, { "user.id": user.id })
		// Set the session now: accepting an invitation lands the member signed in.
		const { token, expiresAt } = await identity.createSession(user.id)
		setCookie(c, identity.SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt })
		return c.json(redeemInvitationResponseSchema.parse({ user }), HTTP_STATUS.CREATED)
	})

rolesRoutes.route("/invitations", invitationRoutes)
// Dashboard reads this to hide routes and controls the caller cannot use.
rolesRoutes.openapi(myPermissionsRoute, async (c) => {
	const permissions = await service.listEffectivePermissions(c.get("user").id)
	return c.json(myPermissionsResponseSchema.parse({ permissions }), HTTP_STATUS.OK)
})
rolesRoutes.openapi(myRolesRoute, async (c) => {
	const roles = await service.listAssignedRoles(c.get("user").id)
	return c.json(userRolesResponseSchema.parse({ roles }), HTTP_STATUS.OK)
})

const userRoutes = new OpenAPIHono()
	.openapi(getUsersRoute, async (c) => {
		const users = await service.listUsersWithAccess(c.get("user").id)
		return c.json(userListResponseSchema.parse({ users }), HTTP_STATUS.OK)
	})
	.openapi(resetUserPasswordRoute, async (c) => {
		const user = c.get("user")
		const targetUserId = c.req.valid("param").userId
		if (targetUserId === user.id) {
			return problemResponse(c, PROBLEM_CODES.SELF_PASSWORD_RESET_NOT_ALLOWED, HTTP_STATUS.BAD_REQUEST)
		}

		await service.resetUserPassword(targetUserId, c.req.valid("json").newPassword, user.id)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.openapi(deleteUserRoute, async (c) => {
		const user = c.get("user")
		const targetUserId = c.req.valid("param").userId
		if (targetUserId === user.id) {
			return problemResponse(c, PROBLEM_CODES.SELF_DELETE_NOT_ALLOWED, HTTP_STATUS.BAD_REQUEST)
		}

		await service.deleteUser(targetUserId, user.id)
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})

rolesRoutes.route("/users", userRoutes)

rolesRoutes.openapi(listGrantablePermissionsRoute, (c) => {
	const permissions = service.listGrantablePermissions()
	return c.json(grantablePermissionsResponseSchema.parse({ permissions }), HTTP_STATUS.OK)
})

rolesRoutes.openapi(listRolesRoute, async (c) => {
	const roles = await service.listRoles()
	return c.json(
		roleListResponseSchema.parse({
			roles,
			manageableRoleIds: await service.manageableRoleIds(c.get("user").id, roles),
		}),
		HTTP_STATUS.OK,
	)
})

rolesRoutes.openapi(createRoleRoute, async (c) => {
	const role = await service.createRole(c.req.valid("json"), c.get("user").id)
	return c.json(roleResponseSchema.parse({ role }), HTTP_STATUS.CREATED)
})

rolesRoutes.openapi(updateRoleRoute, async (c) => {
	const role = await service.updateRole(c.req.valid("param").roleId, c.req.valid("json"), c.get("user").id)
	return c.json(roleResponseSchema.parse({ role }), HTTP_STATUS.OK)
})

rolesRoutes.openapi(deleteRoleRoute, async (c) => {
	await service.deleteRole(c.req.valid("param").roleId, c.get("user").id)
	return c.body(null, HTTP_STATUS.NO_CONTENT)
})

rolesRoutes.openapi(assignUserRolesRoute, async (c) => {
	const roles = await service.assignRoles(c.req.valid("param").userId, c.req.valid("json").roleIds, c.get("user").id)
	return c.json(userRolesResponseSchema.parse({ roles }), HTTP_STATUS.OK)
})
