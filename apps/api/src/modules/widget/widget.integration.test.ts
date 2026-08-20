import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"
import { beforeEach, describe, expect, it } from "bun:test"

import * as service from "./widget.service.ts"

async function createAgent(name = "Docs helper"): Promise<string> {
	const owner = await identity.createAccount({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
	return (await agent.createAgent({ name, ownerId: owner.id })).id
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE widget CASCADE`
	await sql`TRUNCATE TABLE blacklist_word, agent CASCADE`
})

describe("widget lifecycle", () => {
	it("creates a widget with the default palette and a unique public token", async () => {
		const agentId = await createAgent()

		const first = await service.createWidget({ agentId, name: "Marketing site" })
		const second = await service.createWidget({ agentId, name: "Support portal" })

		expect(first.appearance).toEqual(DEFAULT_WIDGET_APPEARANCE)
		expect(first.publicToken).not.toBe(second.publicToken)
		expect(first.publicToken.length).toBeGreaterThan(0)
	})

	it("lets one agent serve several widgets", async () => {
		const agentId = await createAgent()
		await service.createWidget({ agentId, name: "Marketing site" })
		await service.createWidget({ agentId, name: "Support portal" })

		const widgets = await service.listWidgets()

		expect(widgets).toHaveLength(2)
		expect(widgets.every((widget) => widget.agentId === agentId)).toBe(true)
	})

	it("stores a custom palette and reads it back unchanged", async () => {
		const agentId = await createAgent()
		const appearance = {
			primary: "#7c3aed",
			primaryForeground: "#ffffff",
			background: "#0a0a0a",
			foreground: "#fafafa",
			position: "bottom-left",
			theme: "dark",
			themeToggle: false,
			language: "cs",
		} as const

		const created = await service.createWidget({ agentId, name: "Dark site", appearance })

		expect((await service.getWidget(created.id)).appearance).toEqual(appearance)
	})

	it("applies a partial appearance patch without disturbing the other colors", async () => {
		const agentId = await createAgent()
		const created = await service.createWidget({ agentId, name: "Marketing site" })

		const updated = await service.updateWidget(created.id, { appearance: { primary: "#123456" } })

		expect(updated.appearance.primary).toBe("#123456")
		expect(updated.appearance.background).toBe(DEFAULT_WIDGET_APPEARANCE.background)
	})

	it("reassigns a widget to a different agent", async () => {
		const first = await createAgent("First")
		const second = await createAgent("Second")
		const created = await service.createWidget({ agentId: first, name: "Marketing site" })

		expect((await service.updateWidget(created.id, { agentId: second })).agentId).toBe(second)
	})

	it("rejects an unknown agent on create and on reassignment", async () => {
		const agentId = await createAgent()
		const created = await service.createWidget({ agentId, name: "Marketing site" })

		await expect(service.createWidget({ agentId: crypto.randomUUID(), name: "Orphan" })).rejects.toThrow(
			service.UnknownAgentError,
		)
		await expect(service.updateWidget(created.id, { agentId: crypto.randomUUID() })).rejects.toThrow(
			service.UnknownAgentError,
		)
	})

	it("raises a typed error for an unknown widget", async () => {
		await expect(service.getWidget(crypto.randomUUID())).rejects.toThrow(service.WidgetNotFoundError)
		await expect(service.deleteWidget(crypto.randomUUID())).rejects.toThrow(service.WidgetNotFoundError)
	})
})

describe("agent deletion", () => {
	it("refuses to delete an agent that still serves a widget", async () => {
		const agentId = await createAgent()
		await service.createWidget({ agentId, name: "Marketing site" })

		await expect(agent.deleteAgent(agentId)).rejects.toThrow(agent.AgentInUseError)
	})

	it("allows deletion once the last widget is removed", async () => {
		const agentId = await createAgent()
		const created = await service.createWidget({ agentId, name: "Marketing site" })

		await service.deleteWidget(created.id)

		await expect(agent.deleteAgent(agentId)).resolves.toBeUndefined()
	})
})

describe("public config lookup", () => {
	it("returns the appearance and agent for a known token", async () => {
		const agentId = await createAgent()
		const created = await service.createWidget({ agentId, name: "Marketing site" })

		const config = await service.getConfigByToken(created.publicToken)

		expect(config.version).toBe(service.WIDGET_CONFIG_VERSION)
		expect(config.agentId).toBe(agentId)
		expect(config.appearance).toEqual(DEFAULT_WIDGET_APPEARANCE)
	})

	it("rejects an unknown token", async () => {
		await expect(service.getConfigByToken("nope")).rejects.toThrow(service.WidgetNotFoundError)
	})

	// 404 rather than 401: the exemption fired and the lookup simply missed. Needs a real
	// database, so it cannot live beside the route unit tests.
	it("is reachable without a session so embedded widgets can boot", async () => {
		expect((await app.request("/api/widget-config/not-a-real-token")).status).toBe(404)
	})

	it("serves the updated appearance to already-embedded widgets", async () => {
		const agentId = await createAgent()
		const created = await service.createWidget({ agentId, name: "Marketing site" })

		await service.updateWidget(created.id, { appearance: { primary: "#ff0000" } })

		expect((await service.getConfigByToken(created.publicToken)).appearance.primary).toBe("#ff0000")
	})

	it("serves the config over HTTP without a session, with cache headers", async () => {
		const agentId = await createAgent()
		const created = await service.createWidget({ agentId, name: "Marketing site" })

		const response = await app.request(`/api/widget-config/${created.publicToken}`)

		expect(response.status).toBe(200)
		expect(response.headers.get("cache-control")).toContain("max-age=60")
		expect(response.headers.get("etag")).toBeTruthy()
		expect(await response.json()).toEqual({
			version: service.WIDGET_CONFIG_VERSION,
			agentId,
			appearance: DEFAULT_WIDGET_APPEARANCE,
		})
	})

	it("answers 304 for a matching ETag and a fresh 200 once the appearance changes", async () => {
		const agentId = await createAgent()
		const created = await service.createWidget({ agentId, name: "Marketing site" })
		const first = await app.request(`/api/widget-config/${created.publicToken}`)
		const etag = first.headers.get("etag") ?? ""

		const cached = await app.request(`/api/widget-config/${created.publicToken}`, {
			headers: { "If-None-Match": etag },
		})
		expect(cached.status).toBe(304)

		await service.updateWidget(created.id, { appearance: { primary: "#00ff00" } })
		const refreshed = await app.request(`/api/widget-config/${created.publicToken}`, {
			headers: { "If-None-Match": etag },
		})
		expect(refreshed.status).toBe(200)
	})

	it("does not leak the widget's internal id or name", async () => {
		const agentId = await createAgent()
		const created = await service.createWidget({ agentId, name: "Internal name" })

		const body = await (await app.request(`/api/widget-config/${created.publicToken}`)).text()

		expect(body).not.toContain(created.id)
		expect(body).not.toContain("Internal name")
	})
})
