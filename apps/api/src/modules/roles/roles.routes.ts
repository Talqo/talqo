import type { AuthedVariables } from "@/http/require-auth.ts"

import { parseJsonBody } from "@/http/json-body.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/pg-error.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { Hono } from "hono"
import { z } from "zod"

import {
	bootstrapAdminRequestSchema,
	bootstrapAdminResponseSchema,
	accessResponseSchema,
	createGrantRequestSchema,
	createInvitationResponseSchema,
	grantResponseSchema,
	redeemInvitationRequestSchema,
	redeemInvitationResponseSchema,
	resetPasswordRequestSchema,
	setupStatusResponseSchema,
} from "./roles.contract.ts"
import * as service from "./roles.service.ts"

export const rolesRoutes = new Hono<{ Variables: AuthedVariables }>()
	.get("/api/access", async (c) => {
		return c.json(accessResponseSchema.parse(await service.getAccess(c.get("user").id)))
	})
	.get("/api/setup", async (c) => {
		const needsSetup = !(await service.hasAdmin())
		return c.json(setupStatusResponseSchema.parse({ needsSetup }))
	})
	.post("/api/setup", async (c) => {
		const body = bootstrapAdminRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			const user = await service.bootstrapAdmin(body.data)
			return c.json(bootstrapAdminResponseSchema.parse({ user }), HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof service.AdminAlreadyExistsError) {
				return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
			}
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, HTTP_STATUS.CONFLICT)
			throw error
		}
	})
	.post("/api/invitations", async (c) => {
		const user = c.get("user")
		if (!(await service.authorize(user.id, "users:invite"))) {
			return c.json({ error: "Missing users:invite permission" }, HTTP_STATUS.FORBIDDEN)
		}

		const { token, expiresAt } = await service.createInvitation(user.id)
		return c.json(createInvitationResponseSchema.parse({ token, expiresAt }), HTTP_STATUS.CREATED)
	})
	.post("/api/invitations/redeem", async (c) => {
		const body = redeemInvitationRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			const user = await service.redeemInvitation(body.data)
			return c.json(redeemInvitationResponseSchema.parse({ user }), HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof service.InvalidInvitationError) {
				return c.json({ error: error.message }, HTTP_STATUS.CONFLICT)
			}
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, HTTP_STATUS.CONFLICT)
			throw error
		}
	})
	.post("/api/permission-grants", async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return c.json({ error: "Admin access required" }, HTTP_STATUS.FORBIDDEN)
		}

		const body = createGrantRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			const grant = await service.grantPermission({ ...body.data, grantedBy: user.id })
			return c.json(grantResponseSchema.parse({ grant }), HTTP_STATUS.CREATED)
		} catch (error) {
			if (isForeignKeyViolation(error)) return c.json({ error: "User not found" }, HTTP_STATUS.NOT_FOUND)
			throw error
		}
	})
	.delete("/api/permission-grants/:id", async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return c.json({ error: "Admin access required" }, HTTP_STATUS.FORBIDDEN)
		}

		await service.revokePermission(c.req.param("id"))
		return c.body(null, HTTP_STATUS.NO_CONTENT)
	})
	.patch("/api/users/:userId/password", async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return c.json({ error: "Admin access required" }, HTTP_STATUS.FORBIDDEN)
		}

		const body = resetPasswordRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		try {
			await identity.setPassword(c.req.param("userId"), body.data.newPassword)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof identity.UserNotFoundError) {
				return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
