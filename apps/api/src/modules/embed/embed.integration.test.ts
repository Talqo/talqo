import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { DEFAULT_PASSWORD, uniqueUsername } from "@/test-helpers.ts"
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

	it("persists disable and enable without bumping the access version", async () => {
		const created = await createEmbed(await createAgent())

		const disabled = await service.disableEmbed(created.id)

		expect(disabled.isDisabled).toBe(true)
		expect(disabled.accessVersion).toBe(created.accessVersion)
		expect((await service.getEmbed(created.id)).isDisabled).toBe(true)

		const enabled = await service.enableEmbed(created.id)

		expect(enabled.isDisabled).toBe(false)
		expect(enabled.accessVersion).toBe(created.accessVersion)
		expect((await service.getEmbed(created.id)).isDisabled).toBe(false)
	})

	it("keeps the disabled flag through a whole-object update", async () => {
		const created = await createEmbed(await createAgent())
		await service.disableEmbed(created.id)

		const updated = await replaceEmbed(created, { name: "Renamed" })

		expect(updated.isDisabled).toBe(true)
	})

	it("raises a typed error when disabling or enabling an unknown embed", async () => {
		await expect(service.disableEmbed(crypto.randomUUID())).rejects.toThrow(service.EmbedNotFoundError)
		await expect(service.enableEmbed(crypto.randomUUID())).rejects.toThrow(service.EmbedNotFoundError)
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

	it("reports the disabled flag to already-installed embeds and flips their ETag", async () => {
		const agentId = await createAgent()
		const created = await createEmbed(agentId)

		expect((await service.getConfigByToken(created.embedToken)).isDisabled).toBe(false)
		const before = await app.request(`/api/embed-config/${created.embedToken}`)
		expect(await before.json()).toMatchObject({ isDisabled: false })
		const etag = before.headers.get("etag") ?? ""

		await service.disableEmbed(created.id)

		// A fresh ETag lets every cached embed learn the state within the max-age window.
		const disabled = await app.request(`/api/embed-config/${created.embedToken}`, {
			headers: { "If-None-Match": etag },
		})
		expect(disabled.status).toBe(200)
		expect(await disabled.json()).toMatchObject({ isDisabled: true })
		expect((await service.getConfigByToken(created.embedToken)).isDisabled).toBe(true)
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
			isDisabled: false,
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
})

async function login(username: string, password: string): Promise<string> {
	const response = await app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	})
	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) throw new Error("Expected a Set-Cookie header")
	const [cookiePair] = setCookie.split(";")
	if (!cookiePair) throw new Error("Malformed Set-Cookie header")
	return cookiePair
}

async function createManagerSession(): Promise<string> {
	const username = uniqueUsername()
	const account = await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	await roles.grantPermission({
		userId: account.id,
		permission: roles.Permission.AgentsManage,
		grantedBy: account.id,
	})
	return login(username, DEFAULT_PASSWORD)
}

async function createReaderSession(): Promise<string> {
	const username = uniqueUsername()
	const account = await identity.createAccount({ username, password: DEFAULT_PASSWORD })
	await roles.grantPermission({
		userId: account.id,
		permission: roles.Permission.AgentsRead,
		grantedBy: account.id,
	})
	return login(username, DEFAULT_PASSWORD)
}

describe("embed disable and enable routes", () => {
	it("disables and enables an embed with agents:manage", async () => {
		const cookie = await createManagerSession()
		const created = await createEmbed(await createAgent())

		const disabled = await app.request(`/api/embeds/${created.id}/disable`, {
			method: "POST",
			headers: { Cookie: cookie },
		})

		expect(disabled.status).toBe(200)
		expect(await disabled.json()).toMatchObject({ embed: { id: created.id, isDisabled: true } })
		expect((await service.getEmbed(created.id)).isDisabled).toBe(true)

		const enabled = await app.request(`/api/embeds/${created.id}/enable`, {
			method: "POST",
			headers: { Cookie: cookie },
		})

		expect(enabled.status).toBe(200)
		expect(await enabled.json()).toMatchObject({ embed: { id: created.id, isDisabled: false } })
		expect((await service.getEmbed(created.id)).isDisabled).toBe(false)
	})

	it("denies disabling and enabling for an agent reader without agents:manage", async () => {
		const cookie = await createReaderSession()
		const created = await createEmbed(await createAgent())

		const disabled = await app.request(`/api/embeds/${created.id}/disable`, {
			method: "POST",
			headers: { Cookie: cookie },
		})
		const enabled = await app.request(`/api/embeds/${created.id}/enable`, {
			method: "POST",
			headers: { Cookie: cookie },
		})

		expect(disabled.status).toBe(403)
		expect(await disabled.json()).toMatchObject({ code: "permission-denied" })
		expect(enabled.status).toBe(403)
		expect(await enabled.json()).toMatchObject({ code: "permission-denied" })
		expect((await service.getEmbed(created.id)).isDisabled).toBe(false)
	})

	it("answers 404 when disabling or enabling an unknown embed", async () => {
		const cookie = await createManagerSession()
		const unknown = crypto.randomUUID()

		expect(
			(await app.request(`/api/embeds/${unknown}/disable`, { method: "POST", headers: { Cookie: cookie } })).status,
		).toBe(404)
		expect(
			(await app.request(`/api/embeds/${unknown}/enable`, { method: "POST", headers: { Cookie: cookie } })).status,
		).toBe(404)
	})
})
