import { expect } from "@playwright/test"

import { test as applicationTest } from "./application"
import { ADMIN } from "./log-in"
import { WIDGET_APPEARANCE } from "./widget-appearance"

export const test = applicationTest.extend<{
	chatEmbed: { agentName: string; widgetUrl: string; providerControlOrigin: string }
}>({
	chatEmbed: async ({ request, application }, use) => {
		const agentName = `Chat ${crypto.randomUUID()}`
		const systemPrompt = "You are the support assistant on our company website."
		const providerControlOrigin = `${application.providerOrigin}/control`
		await expect(await request.post(`${providerControlOrigin}/reset`)).toBeOK()
		await expect(await request.post("/api/auth/login", { data: ADMIN })).toBeOK()
		const agentResponse = await request.post("/api/agents", {
			data: {
				name: agentName,
				systemPrompt,
				wordBlacklist: ["Intercom", "Zendesk"],
			},
		})
		await expect(agentResponse).toBeOK()
		const createdAgent: unknown = await agentResponse.json()
		if (
			!createdAgent ||
			typeof createdAgent !== "object" ||
			!("agent" in createdAgent) ||
			!createdAgent.agent ||
			typeof createdAgent.agent !== "object" ||
			!("id" in createdAgent.agent) ||
			typeof createdAgent.agent.id !== "string"
		)
			throw new Error("Agent response is missing its id")
		const agentId = createdAgent.agent.id
		let embedId: string | undefined
		try {
			const embedResponse = await request.post("/api/embeds", {
				data: { agentId, name: "Chat test", appearance: WIDGET_APPEARANCE },
			})
			await expect(embedResponse).toBeOK()
			const createdEmbed: unknown = await embedResponse.json()
			if (
				!createdEmbed ||
				typeof createdEmbed !== "object" ||
				!("embed" in createdEmbed) ||
				!createdEmbed.embed ||
				typeof createdEmbed.embed !== "object" ||
				!("id" in createdEmbed.embed) ||
				typeof createdEmbed.embed.id !== "string" ||
				!("embedToken" in createdEmbed.embed) ||
				typeof createdEmbed.embed.embedToken !== "string"
			)
				throw new Error("Embed response is missing its id or token")
			embedId = createdEmbed.embed.id
			const widgetUrl = new URL("/", application.widgetHostOrigin)
			widgetUrl.searchParams.set("token", createdEmbed.embed.embedToken)
			widgetUrl.searchParams.set("api", application.origin)
			await use({ agentName, widgetUrl: widgetUrl.href, providerControlOrigin })
		} finally {
			await expect(await request.post(`${providerControlOrigin}/reset`)).toBeOK()
			if (embedId) await expect(await request.delete(`/api/embeds/${embedId}`)).toBeOK()
			await expect(await request.delete(`/api/agents/${agentId}`)).toBeOK()
		}
	},
})
