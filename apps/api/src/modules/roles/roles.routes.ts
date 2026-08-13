import type { AuthedVariables } from "@/http/require-auth.ts"

import { parseJsonBody } from "@/http/json-body.ts"
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/pg-error.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { Hono } from "hono"
import { z } from "zod"

import {
	bootstrapAdminRequestSchema,
	createGrantRequestSchema,
	redeemInvitationRequestSchema,
	resetPasswordRequestSchema,
	setupStatusResponseSchema,
} from "./roles.contract.ts"
import * as service from "./roles.service.ts"

export const rolesRoutes = new Hono<{ Variables: AuthedVariables }>()
	.get("/api/setup", async (c) => {
		const needsSetup = !(await service.hasAdmin())
		return c.json(setupStatusResponseSchema.parse({ needsSetup }))
	})
	.post("/api/setup", async (c) => {
		const body = bootstrapAdminRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

		try {
			const user = await service.bootstrapAdmin(body.data)
			return c.json({ user }, 201)
		} catch (error) {
			if (error instanceof service.AdminAlreadyExistsError) {
				return c.json({ error: error.message }, 409)
			}
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, 409)
			throw error
		}
	})
	.post("/api/invitations", async (c) => {
		const user = c.get("user")
		if (!(await service.authorize(user.id, "users:invite"))) {
			return c.json({ error: "Missing users:invite permission" }, 403)
		}

		const { token, expiresAt } = await service.createInvitation(user.id)
		return c.json({ token, expiresAt }, 201)
	})
	.post("/api/invitations/redeem", async (c) => {
		const body = redeemInvitationRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

		try {
			const user = await service.redeemInvitation(body.data)
			return c.json({ user }, 201)
		} catch (error) {
			if (error instanceof service.InvalidInvitationError) {
				return c.json({ error: error.message }, 409)
			}
			if (isUniqueViolation(error)) return c.json({ error: "Username already in use" }, 409)
			throw error
		}
	})
	.post("/api/permission-grants", async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return c.json({ error: "Admin access required" }, 403)
		}

		const body = createGrantRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

		try {
			const grant = await service.grantPermission({ ...body.data, grantedBy: user.id })
			return c.json({ grant }, 201)
		} catch (error) {
			if (isForeignKeyViolation(error)) return c.json({ error: "User not found" }, 404)
			throw error
		}
	})
	.delete("/api/permission-grants/:id", async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return c.json({ error: "Admin access required" }, 403)
		}

		await service.revokePermission(c.req.param("id"))
		return c.body(null, 204)
	})
	.patch("/api/users/:userId/password", async (c) => {
		const user = c.get("user")
		if (!(await service.isAdmin(user.id))) {
			return c.json({ error: "Admin access required" }, 403)
		}

		const body = resetPasswordRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

		try {
			await identity.setPassword(c.req.param("userId"), body.data.newPassword)
			return c.body(null, 204)
		} catch (error) {
			if (error instanceof identity.UserNotFoundError) {
				return c.json({ error: error.message }, 404)
			}
			throw error
		}
	})
