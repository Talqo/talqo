import type { AuthedVariables } from "@/http/require-auth.ts"

import { parseJsonBody } from "@/http/json-body.ts"
import { isUniqueViolation } from "@/lib/pg-error.ts"
import { Hono } from "hono"
import { z } from "zod"

import { bootstrapAdminRequestSchema, setupStatusResponseSchema } from "./roles.contract.ts"
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
