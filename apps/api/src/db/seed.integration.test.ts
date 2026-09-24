import * as agent from "@/modules/agent/agent.service.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.repository.ts"
import * as embed from "@/modules/embed/embed.service.ts"
import * as identity from "@/modules/identity/identity.repository.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import { sql } from "./client.ts"
import { seed } from "./seed.ts"

const SEED_AGENT_ID = "11111111-1111-4111-8111-111111111111"
const SEED_EMBED_ID = "22222222-2222-4222-8222-222222222222"

const SEED_ENV = {
	TALQO_ALLOW_INSECURE_SEED: "true",
	TALQO_SEED_AI_BASE_URL: "http://127.0.0.1:1/v1",
	TALQO_SEED_AI_API_KEY: "seed-provider-key",
	TALQO_SEED_TEXT_MODEL: "chat-model",
	TALQO_SEED_EMBEDDING_MODEL: "embedding-model",
}

// Integration files share one process, so restore the environment for later files.
const previousEnv = Object.fromEntries(Object.keys(SEED_ENV).map((key) => [key, Bun.env[key]]))

beforeAll(() => {
	Object.assign(Bun.env, SEED_ENV)
})

afterAll(() => {
	for (const [key, value] of Object.entries(previousEnv)) {
		if (value === undefined) delete Bun.env[key]
		else Bun.env[key] = value
	}
})

beforeEach(async () => {
	await sql`TRUNCATE TABLE embed, blacklist_word, agent, ai_provider_config, permission_grant, invitation, session, "user" CASCADE`
})

describe("development seed", () => {
	it("seeds the full baseline into an empty database", async () => {
		await seed()

		expect(await identity.findUserByUsername("admin")).toBeDefined()
		expect(await identity.findUserByUsername("user")).toBeDefined()
		expect(await roles.hasAdmin()).toBe(true)
		expect((await agent.getAgent(SEED_AGENT_ID)).name).toBe("Website Assistant")
		expect((await embed.getEmbed(SEED_EMBED_ID)).agentId).toBe(SEED_AGENT_ID)
		expect(await aiProvider.find()).toMatchObject({ revision: 1, text: { modelId: "chat-model" } })
	})

	it("keeps edits to seeded records when it runs again", async () => {
		await seed()
		await agent.updateAgent(SEED_AGENT_ID, {
			name: "Renamed",
			systemPrompt: "Edited prompt",
			wordBlacklist: ["Edited"],
		})
		const seeded = await embed.getEmbed(SEED_EMBED_ID)
		const appearance = { ...seeded.appearance, light: { ...seeded.appearance.light, primary: "#123456" } }
		await embed.updateEmbed(SEED_EMBED_ID, { agentId: seeded.agentId, name: "Edited site", appearance })
		const provider = await aiProvider.find()
		if (!provider) throw new Error("Expected the seeded AI provider configuration")
		await aiProvider.save({ ...provider, text: { ...provider.text, modelId: "edited-model" } }, provider.revision)

		await seed()

		expect(await agent.getAgent(SEED_AGENT_ID)).toMatchObject({
			name: "Renamed",
			systemPrompt: "Edited prompt",
			wordBlacklist: ["Edited"],
		})
		expect(await embed.getEmbed(SEED_EMBED_ID)).toMatchObject({ name: "Edited site", appearance })
		expect(await aiProvider.find()).toMatchObject({ revision: 2, text: { modelId: "edited-model" } })
	})

	// Insert-only works per record, so a deleted seed record returns on the next run.
	it("recreates a deleted seed record", async () => {
		await seed()
		await embed.deleteEmbed(SEED_EMBED_ID)

		await seed()

		expect((await embed.getEmbed(SEED_EMBED_ID)).name).toBe("Website")
	})
})
