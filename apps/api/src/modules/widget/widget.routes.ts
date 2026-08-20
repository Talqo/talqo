import type { AuthedVariables } from "@/http/require-auth.ts"

import { parseJsonBody } from "@/http/json-body.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { Hono } from "hono"
import { z } from "zod"

import {
	createWidgetRequestSchema,
	updateWidgetRequestSchema,
	widgetConfigResponseSchema,
	widgetListResponseSchema,
	widgetResponseSchema,
} from "./widget.contract.ts"
import * as service from "./widget.service.ts"

// Short enough that an appearance change reaches live sites promptly (there is no
// purge), long enough to keep a busy host page off the API on every navigation.
const CONFIG_MAX_AGE_SECONDS = 60
const CONFIG_STALE_WHILE_REVALIDATE_SECONDS = 300

export const widgetRoutes = new Hono<{ Variables: AuthedVariables }>()
	.get("/widget-config/:token", async (c) => {
		try {
			const config = await service.getConfigByToken(c.req.param("token"))
			const etag = `W/"${config.updatedAt.getTime()}"`
			if (c.req.header("if-none-match") === etag) {
				return c.body(null, HTTP_STATUS.NOT_MODIFIED)
			}
			c.header(
				"Cache-Control",
				`public, max-age=${CONFIG_MAX_AGE_SECONDS}, stale-while-revalidate=${CONFIG_STALE_WHILE_REVALIDATE_SECONDS}`,
			)
			c.header("ETag", etag)
			return c.json(widgetConfigResponseSchema.parse(config))
		} catch (error) {
			if (error instanceof service.WidgetNotFoundError) {
				return c.json({ error: "Widget not found" }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.get("/widgets", async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:read"))) {
			return c.json({ error: "Missing agents:read permission" }, HTTP_STATUS.FORBIDDEN)
		}
		return c.json(widgetListResponseSchema.parse({ widgets: await service.listWidgets() }))
	})
	.post("/widgets", async (c) => {
		const user = c.get("user")
		const body = createWidgetRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const widget = await service.createWidget(body.data)
			return c.json(widgetResponseSchema.parse({ widget }), HTTP_STATUS.CREATED)
		} catch (error) {
			if (error instanceof service.UnknownAgentError) {
				return c.json({ error: "Agent not found" }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.get("/widgets/:id", async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:read"))) {
			return c.json({ error: "Missing agents:read permission" }, HTTP_STATUS.FORBIDDEN)
		}
		try {
			return c.json(widgetResponseSchema.parse({ widget: await service.getWidget(c.req.param("id")) }))
		} catch (error) {
			if (error instanceof service.WidgetNotFoundError) {
				return c.json({ error: "Widget not found" }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.patch("/widgets/:id", async (c) => {
		const user = c.get("user")
		const id = c.req.param("id")
		const body = updateWidgetRequestSchema.safeParse(await parseJsonBody(c))
		if (!body.success) return c.json({ error: z.prettifyError(body.error) }, HTTP_STATUS.BAD_REQUEST)

		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			return c.json(widgetResponseSchema.parse({ widget: await service.updateWidget(id, body.data) }))
		} catch (error) {
			if (error instanceof service.WidgetNotFoundError) {
				return c.json({ error: "Widget not found" }, HTTP_STATUS.NOT_FOUND)
			}
			if (error instanceof service.UnknownAgentError) {
				return c.json({ error: "Agent not found" }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
	.delete("/widgets/:id", async (c) => {
		const user = c.get("user")
		const id = c.req.param("id")

		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			await service.deleteWidget(id)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			if (error instanceof service.WidgetNotFoundError) {
				return c.json({ error: "Widget not found" }, HTTP_STATUS.NOT_FOUND)
			}
			throw error
		}
	})
