import type { AuthedVariables } from "@/http/require-auth.ts"

import { PROBLEM_CODES, problemResponse } from "@/http/problem.ts"
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

// There is no purge, so this bounds how long a live site keeps a stale palette. No
// stale-while-revalidate: a shared cache would serve it past the window ADR-0013 promises.
const CONFIG_MAX_AGE_SECONDS = 60

function mapDomainError(error: unknown) {
	if (error instanceof service.WidgetNotFoundError) {
		return { code: PROBLEM_CODES.WIDGET_NOT_FOUND, status: HTTP_STATUS.NOT_FOUND }
	}
	if (error instanceof service.UnknownAgentError) {
		return { code: PROBLEM_CODES.AGENT_NOT_FOUND, status: HTTP_STATUS.NOT_FOUND }
	}
	return null
}

export const widgetRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>()
	.openapi(listWidgetsRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsRead))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}
		const { agentId } = c.req.valid("query")
		return c.json(widgetListResponseSchema.parse({ widgets: await service.listWidgets(agentId) }), HTTP_STATUS.OK)
	})
	.openapi(createWidgetRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const widget = await service.createWidget(c.req.valid("json"))
			return c.json(widgetDetailResponseSchema.parse({ widget }), HTTP_STATUS.CREATED)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})
	.openapi(getWidgetRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsRead))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const widget = await service.getWidget(c.req.valid("param").widgetId)
			return c.json(widgetDetailResponseSchema.parse({ widget }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})
	.openapi(updateWidgetRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			const widget = await service.updateWidget(c.req.valid("param").widgetId, c.req.valid("json"))
			return c.json(widgetDetailResponseSchema.parse({ widget }), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})
	.openapi(deleteWidgetRoute, async (c) => {
		const user = c.get("user")
		if (!(await roles.authorize(user.id, roles.Permission.AgentsManage))) {
			return problemResponse(c, PROBLEM_CODES.PERMISSION_DENIED, HTTP_STATUS.FORBIDDEN)
		}

		try {
			await service.deleteWidget(c.req.valid("param").widgetId)
			return c.body(null, HTTP_STATUS.NO_CONTENT)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	})

// Mounted apart from the CRUD namespace so its auth exemption can never widen into
// `/api/widgets` (ADR-0013); `widget.routes.test.ts` guards that boundary.
export const widgetConfigRoutes = new OpenAPIHono<{ Variables: AuthedVariables }>().openapi(
	getWidgetConfigRoute,
	async (c) => {
		try {
			const config = await service.getConfigByToken(c.req.valid("param").token)
			const etag = `W/"${config.updatedAt.getTime()}"`
			if (c.req.header("if-none-match") === etag) {
				return c.body(null, HTTP_STATUS.NOT_MODIFIED)
			}
			c.header("Cache-Control", `public, max-age=${CONFIG_MAX_AGE_SECONDS}`)
			c.header("ETag", etag)
			return c.json(widgetConfigResponseSchema.parse(config), HTTP_STATUS.OK)
		} catch (error) {
			const mapped = mapDomainError(error)
			if (mapped) return problemResponse(c, mapped.code, mapped.status as never)
			throw error
		}
	},
)
