import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import { DEFAULT_WIDGET_APPEARANCE, WIDGET_CONFIG_VERSION } from "@talqo/shared/widget-appearance"
import { beforeEach, describe, expect, it } from "bun:test"

import * as service from "./widget.service.ts"

async function createAgent(name = "Docs helper"): Promise<string> {
	return (
		await agent.createAgent({ name, systemPrompt: "You help visitors with product questions.", wordBlacklist: [] })
	).id
}

async function createWidget(agentId: string, overrides: Partial<service.WidgetInput> = {}): Promise<service.Widget> {
	return service.createWidget({ agentId, name: "Marketing site", appearance: DEFAULT_WIDGET_APPEARANCE, ...overrides })
}

/** Both write paths take a whole widget, so a targeted change overrides the stored one. */
async function replaceWidget(widget: service.Widget, overrides: Partial<service.WidgetInput>): Promise<service.Widget> {
	const { agentId, name, appearance } = widget
	return service.updateWidget(widget.id, { agentId, name, appearance, ...overrides })
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE widget CASCADE`
	await sql`TRUNCATE TABLE blacklist_word, agent CASCADE`
})

describe("widget lifecycle", () => {
	it("mints a distinct public token per widget", async () => {
		const agentId = await createAgent()

		const first = await createWidget(agentId)
		const second = await createWidget(agentId, { name: "Support portal" })

		expect(first.publicToken).not.toBe(second.publicToken)
		expect(first.publicToken.length).toBeGreaterThan(0)
	})

	it("lets one agent serve several widgets", async () => {
		const agentId = await createAgent()
		await createWidget(agentId)
		await createWidget(agentId, { name: "Support portal" })

		const widgets = await service.listWidgets()

		expect(widgets).toHaveLength(2)
		expect(widgets.every((widget) => widget.agentId === agentId)).toBe(true)
	})

	it("filters by agent so one agent's page never fetches another agent's widgets", async () => {
		const first = await createAgent("First")
		const second = await createAgent("Second")
		await createWidget(first)
		await createWidget(second, { name: "Support portal" })

		const widgets = await service.listWidgets(first)

		expect(widgets).toHaveLength(1)
		expect(widgets[0]?.agentId).toBe(first)
	})

	it("stores a custom light and dark palette and reads it back unchanged", async () => {
		const agentId = await createAgent()
		const appearance = {
			light: {
				primary: "#7c3aed",
				textOnPrimary: "#ffffff",
				background: "#fafafa",
				surface: "#eeeeee",
				text: "#0a0a0a",
			},
			dark: {
				primary: "#a78bfa",
				textOnPrimary: "#1e1b4b",
				background: "#0a0a0a",
				surface: "#171717",
				text: "#fafafa",
			},
			position: "bottom-left",
			theme: "dark",
			themeToggle: false,
			language: "cs",
		} as const

		const created = await createWidget(agentId, { name: "Dark site", appearance })

		expect((await service.getWidget(created.id)).appearance).toEqual(appearance)
	})

	it("replaces the whole appearance on update", async () => {
		const agentId = await createAgent()
		const created = await createWidget(agentId)
		const appearance = {
			...DEFAULT_WIDGET_APPEARANCE,
			light: { ...DEFAULT_WIDGET_APPEARANCE.light, primary: "#123456" },
			theme: "dark",
		} as const

		expect((await replaceWidget(created, { appearance })).appearance).toEqual(appearance)
	})

	it("reassigns a widget to a different agent", async () => {
		const first = await createAgent("First")
		const second = await createAgent("Second")
		const created = await createWidget(first)

		expect((await replaceWidget(created, { agentId: second })).agentId).toBe(second)
	})

	it("rejects an unknown agent on create and on reassignment", async () => {
		const agentId = await createAgent()
		const created = await createWidget(agentId)

		await expect(createWidget(crypto.randomUUID(), { name: "Orphan" })).rejects.toThrow(service.UnknownAgentError)
		await expect(replaceWidget(created, { agentId: crypto.randomUUID() })).rejects.toThrow(service.UnknownAgentError)
	})

	it("raises a typed error for an unknown widget", async () => {
		await expect(service.getWidget(crypto.randomUUID())).rejects.toThrow(service.WidgetNotFoundError)
		await expect(service.deleteWidget(crypto.randomUUID())).rejects.toThrow(service.WidgetNotFoundError)
	})
})

describe("agent deletion", () => {
	it("refuses to delete an agent that still serves a widget", async () => {
		const agentId = await createAgent()
		await createWidget(agentId)

		await expect(agent.deleteAgent(agentId)).rejects.toThrow(agent.AgentInUseError)
	})

	it("allows deletion once the last widget is removed", async () => {
		const agentId = await createAgent()
		const created = await createWidget(agentId)

		await service.deleteWidget(created.id)

		await expect(agent.deleteAgent(agentId)).resolves.toBeUndefined()
	})
})

describe("public config lookup", () => {
	it("returns the appearance, agent, and name for a known token", async () => {
		const agentId = await createAgent()
		const created = await createWidget(agentId, { name: "Marketing site" })

		const config = await service.getConfigByToken(created.publicToken)

		expect(config.version).toBe(WIDGET_CONFIG_VERSION)
		expect(config.agentId).toBe(agentId)
		expect(config.name).toBe("Marketing site")
		expect(config.appearance).toEqual(DEFAULT_WIDGET_APPEARANCE)
	})

	it("rejects an unknown token", async () => {
		await expect(service.getConfigByToken("nope")).rejects.toThrow(service.WidgetNotFoundError)
	})

	// 404, not 401: the exemption fired and the lookup missed.
	it("is reachable without a session so embedded widgets can boot", async () => {
		expect((await app.request("/api/widget-config/not-a-real-token")).status).toBe(404)
	})

	it("serves the updated appearance to already-embedded widgets", async () => {
		const agentId = await createAgent()
		const created = await createWidget(agentId)

		await replaceWidget(created, {
			appearance: { ...created.appearance, light: { ...created.appearance.light, primary: "#ff0000" } },
		})

		expect((await service.getConfigByToken(created.publicToken)).appearance.light.primary).toBe("#ff0000")
	})

	it("serves the config over HTTP without a session, with cache headers", async () => {
		const agentId = await createAgent()
		const created = await createWidget(agentId, { name: "Marketing site" })

		const response = await app.request(`/api/widget-config/${created.publicToken}`)

		expect(response.status).toBe(200)
		expect(response.headers.get("cache-control")).toBe("public, max-age=60")
		expect(response.headers.get("etag")).toBeTruthy()
		expect(await response.json()).toEqual({
			version: WIDGET_CONFIG_VERSION,
			agentId,
			name: "Marketing site",
			appearance: DEFAULT_WIDGET_APPEARANCE,
		})
	})

	it("answers 304 for a matching ETag and a fresh 200 once the appearance changes", async () => {
		const agentId = await createAgent()
		const created = await createWidget(agentId)
		const first = await app.request(`/api/widget-config/${created.publicToken}`)
		const etag = first.headers.get("etag") ?? ""

		const cached = await app.request(`/api/widget-config/${created.publicToken}`, {
			headers: { "If-None-Match": etag },
		})
		expect(cached.status).toBe(304)

		await replaceWidget(created, {
			appearance: { ...created.appearance, light: { ...created.appearance.light, primary: "#00ff00" } },
		})
		const refreshed = await app.request(`/api/widget-config/${created.publicToken}`, {
			headers: { "If-None-Match": etag },
		})
		expect(refreshed.status).toBe(200)
	})

	// The name is public by design (the embed shows it); the internal id is not.
	it("does not leak the widget's internal id", async () => {
		const agentId = await createAgent()
		const created = await createWidget(agentId, { name: "Internal name" })

		const body = await (await app.request(`/api/widget-config/${created.publicToken}`)).text()

		expect(body).not.toContain(created.id)
	})
})
