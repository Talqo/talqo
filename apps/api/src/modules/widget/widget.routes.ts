import type { AuthedVariables } from "@/http/require-auth.ts"

import { HTTP_STATUS } from "@/http/status.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { OpenAPIHono } from "@hono/zod-openapi"

import {
	createWidgetRoute,
	deleteWidgetRoute,
	getWidgetConfigRoute,
	getWidgetRoute,
	listWidgetsRoute,
	updateWidgetRoute,
	widgetConfigResponseSchema,
	widgetDetailResponseSchema,
	widgetListResponseSchema,
} from "./widget.contract.ts"
import * as service from "./widget.service.ts"

// Short enough that an appearance change reaches live sites promptly (there is no
// purge), long enough to keep a busy host page off the API on every navigation.
const CONFIG_MAX_AGE_SECONDS = 60
const CONFIG_STALE_WHILE_REVALIDATE_SECONDS = 300

function mapDomainError(error: unknown): { body: { error: string }; status: number } | null {
	if (error instanceof service.WidgetNotFoundError) {
		return { body: { error: "Widget not found" }, status: HTTP_STATUS.NOT_FOUND }
	}
	if (error instanceof service.UnknownAgentError) {
		return { body: { error: "Agent not found" }, status: HTTP_STATUS.NOT_FOUND }
	}
	return null
}

export const widgetRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(listWidgetsRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:read"))) {
			return c.json({ error: "Missing agents:read permission" }, HTTP_STATUS.FORBIDDEN)
		}
		return c.json(widgetListResponseSchema.parse({ widgets: await service.listWidgets() }), HTTP_STATUS.OK)
	})
	.openapi(createWidgetRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const widget = await service.createWidget(c.req.valid("json"))
			return c.json(widgetDetailResponseSchema.parse({ widget }), HTTP_STATUS.CREATED)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	})
	.openapi(getWidgetRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:read"))) {
			return c.json({ error: "Missing agents:read permission" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const widget = await service.getWidget(c.req.valid("param").widgetId)
			return c.json(widgetDetailResponseSchema.parse({ widget }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	})
	.openapi(updateWidgetRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const widget = await service.updateWidget(c.req.valid("param").widgetId, c.req.valid("json"))
			return c.json(widgetDetailResponseSchema.parse({ widget }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	})
	.openapi(deleteWidgetRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, "agents:manage"))) {
			return c.json({ error: "Missing agents:manage permission" }, HTTP_STATUS.FORBIDDEN)
		}

		try {
			await service.deleteWidget(c.req.valid("param").widgetId)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	})

// Mounted apart from the CRUD namespace so an auth exemption for this path can never
// widen into `/api/widgets` (ADR-0011); `widget.routes.test.ts` guards that boundary.
export const widgetConfigRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>().openapi(
	getWidgetConfigRoute,
	async (c) => {
		try {
			const config = await service.getConfigByToken(c.req.valid("param").token)
			const etag = `W/"${config.updatedAt.getTime()}"`
			if (c.req.header("if-none-match") === etag) {
				return c.body(null, HTTP_STATUS.NOT_MODIFIED)
			}
			c.header(
				"Cache-Control",
				`public, max-age=${CONFIG_MAX_AGE_SECONDS}, stale-while-revalidate=${CONFIG_STALE_WHILE_REVALIDATE_SECONDS}`,
			)
			c.header("ETag", etag)
			return c.json(widgetConfigResponseSchema.parse(config), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return c.json(mapped.body, mapped.status as never)
			throw error
		}
	},
)
