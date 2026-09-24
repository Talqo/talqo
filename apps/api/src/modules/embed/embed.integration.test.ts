import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import { DEFAULT_WIDGET_APPEARANCE, WIDGET_CONFIG_VERSION } from "@talqo/shared/widget-appearance"
import { beforeEach, describe, expect, it } from "bun:test"

import * as service from "./embed.service.ts"

async function createAgent(name = "Docs helper"): Promise<string> {
	return (
		await agent.createAgent({ name, systemPrompt: "You help visitors with product questions.", wordBlacklist: [] })
	).id
}

async function createEmbed(agentId: string, overrides: Partial<service.EmbedInput> = {}): Promise<service.Embed> {
	return service.createEmbed({ agentId, name: "Marketing site", appearance: DEFAULT_WIDGET_APPEARANCE, ...overrides })
}

/** Both write paths take a whole embed, so a targeted change overrides the stored one. */
async function replaceEmbed(embed: service.Embed, overrides: Partial<service.EmbedInput>): Promise<service.Embed> {
	const { agentId, name, appearance } = embed
	return service.updateEmbed(embed.id, { agentId, name, appearance, ...overrides })
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE embed CASCADE`
	await sql`TRUNCATE TABLE blacklist_word, agent CASCADE`
})

describe("embed lifecycle", () => {
	it("mints a distinct embed token and starts at access version one", async () => {
		const agentId = await createAgent()

		const first = await createEmbed(agentId)
		const second = await createEmbed(agentId, { name: "Support portal" })

		expect(first.embedToken).not.toBe(second.embedToken)
		expect(first.embedToken.length).toBeGreaterThan(0)
		expect(first.accessVersion).toBe(1)
	})

	it("lets one agent serve several embeds", async () => {
		const agentId = await createAgent()
		await createEmbed(agentId)
		await createEmbed(agentId, { name: "Support portal" })

		const embeds = await service.listEmbeds()

		expect(embeds).toHaveLength(2)
		expect(embeds.every((embed) => embed.agentId === agentId)).toBe(true)
	})

	it("filters by agent so one agent's page never fetches another agent's embeds", async () => {
		const first = await createAgent("First")
		const second = await createAgent("Second")
		await createEmbed(first)
		await createEmbed(second, { name: "Support portal" })

		const embeds = await service.listEmbeds(first)

		expect(embeds).toHaveLength(1)
		expect(embeds[0]?.agentId).toBe(first)
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

		const created = await createEmbed(agentId, { name: "Dark site", appearance })

		expect((await service.getEmbed(created.id)).appearance).toEqual(appearance)
	})

	it("replaces the whole appearance on update", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId)
		const appearance = {
			...DEFAULT_WIDGET_APPEARANCE,
			light: { ...DEFAULT_WIDGET_APPEARANCE.light, primary: "#123456" },
			theme: "dark",
		} as const

		expect((await replaceEmbed(created, { appearance })).appearance).toEqual(appearance)
	})

	it("reassigns an embed and atomically increments its access version", async () => {
		const first = await createAgent("First")
		const second = await createAgent("Second")
		const created = await createEmbed(first)

		const reassigned = await replaceEmbed(created, { agentId: second })

		expect(reassigned.agentId).toBe(second)
		expect(reassigned.accessVersion).toBe(created.accessVersion + 1)
	})

	it("rotates an embed token and atomically increments its access version", async () => {
		const created = await createEmbed(await createAgent())

		const rotated = await service.rotateEmbedToken(created.id)

		expect(rotated.embedToken).not.toBe(created.embedToken)
		expect(rotated.accessVersion).toBe(created.accessVersion + 1)
		await expect(service.getConfigByToken(created.embedToken)).rejects.toThrow(service.EmbedNotFoundError)
		expect(await service.getConfigByToken(rotated.embedToken)).toMatchObject({ name: created.name })
	})

	it("rejects an unknown agent on create and on reassignment", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId)

		await expect(createEmbed(crypto.randomUUID(), { name: "Orphan" })).rejects.toThrow(service.UnknownAgentError)
		await expect(replaceEmbed(created, { agentId: crypto.randomUUID() })).rejects.toThrow(service.UnknownAgentError)
	})

	it("raises a typed error for an unknown embed", async () => {
		await expect(service.getEmbed(crypto.randomUUID())).rejects.toThrow(service.EmbedNotFoundError)
		await expect(service.deleteEmbed(crypto.randomUUID())).rejects.toThrow(service.EmbedNotFoundError)
	})
})

describe("agent deletion", () => {
	it("refuses to delete an agent that still serves an embed", async () => {
		const agentId = await createAgent()
		await createEmbed(agentId)

		await expect(agent.deleteAgent(agentId)).rejects.toThrow(agent.AgentInUseError)
	})

	it("allows deletion once the last embed is removed", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId)

		await service.deleteEmbed(created.id)

		await expect(agent.deleteAgent(agentId)).resolves.toBeUndefined()
	})
})

describe("public config lookup", () => {
	it("returns public appearance and name without exposing the agent", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId, { name: "Marketing site" })

		const config = await service.getConfigByToken(created.embedToken)

		expect(config.version).toBe(WIDGET_CONFIG_VERSION)
		expect(config.name).toBe("Marketing site")
		expect(config.appearance).toEqual(DEFAULT_WIDGET_APPEARANCE)
		expect(config).not.toHaveProperty("agentId")
	})

	it("rejects an unknown token", async () => {
		await expect(service.getConfigByToken("nope")).rejects.toThrow(service.EmbedNotFoundError)
	})

	// 404, not 401: the exemption fired and the lookup missed.
	it("is reachable without a session so embedded widgets can boot", async () => {
		expect((await app.request("/api/embed-config/not-a-real-token")).status).toBe(404)
	})

	it("serves the updated appearance to already-embedded widgets", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId)

		await replaceEmbed(created, {
			appearance: { ...created.appearance, light: { ...created.appearance.light, primary: "#ff0000" } },
		})

		expect((await service.getConfigByToken(created.embedToken)).appearance.light.primary).toBe("#ff0000")
	})

	it("serves the config over HTTP without a session, with cache headers", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId, { name: "Marketing site" })

		const response = await app.request(`/api/embed-config/${created.embedToken}`)

		expect(response.status).toBe(200)
		expect(response.headers.get("cache-control")).toBe("public, max-age=60")
		expect(response.headers.get("etag")).toBeTruthy()
		expect(await response.json()).toEqual({
			version: WIDGET_CONFIG_VERSION,
			name: "Marketing site",
			appearance: DEFAULT_WIDGET_APPEARANCE,
		})
	})

	it("answers 304 for a matching ETag and a fresh 200 once the appearance changes", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId)
		const first = await app.request(`/api/embed-config/${created.embedToken}`)
		const etag = first.headers.get("etag") ?? ""

		const cached = await app.request(`/api/embed-config/${created.embedToken}`, {
			headers: { "If-None-Match": etag },
		})
		expect(cached.status).toBe(304)

		await replaceEmbed(created, {
			appearance: { ...created.appearance, light: { ...created.appearance.light, primary: "#00ff00" } },
		})
		const refreshed = await app.request(`/api/embed-config/${created.embedToken}`, {
			headers: { "If-None-Match": etag },
		})
		expect(refreshed.status).toBe(200)
	})

	// The name is public by design (the embed shows it); the internal id is not.
	it("does not leak the embed's internal id or agent id", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId, { name: "Internal name" })

		const body = await (await app.request(`/api/embed-config/${created.embedToken}`)).text()

		expect(body).not.toContain(created.id)
		expect(body).not.toContain(agentId)
	})

	it("keeps the shipped widget-config URL compatible with existing tokens", async () => {
		const created = await createEmbed(await createAgent())

		const response = await app.request(`/api/widget-config/${created.embedToken}`)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({ name: created.name })
	})
})
