import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import { ProviderContextLimitError } from "@/modules/ai-provider/ai-provider.service.ts"
import * as embed from "@/modules/embed/embed.service.ts"
import * as usage from "@/modules/usage/usage.service.ts"
import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"
import { beforeEach, describe, expect, it } from "bun:test"

import * as repository from "./conversation.repository.ts"
import {
	ConcurrentGenerationLimitError,
	createConversationService,
	DailyAllowanceExceededError,
	RequestConflictError,
	SessionBusyError,
	SessionUnauthorizedError,
} from "./conversation.service.ts"

const APP_SECRET = Buffer.alloc(32, 6).toString("base64url")
const REQUEST_1 = Buffer.alloc(16, 1).toString("base64url")
const REQUEST_2 = Buffer.alloc(16, 2).toString("base64url")
const REQUEST_3 = Buffer.alloc(16, 3).toString("base64url")
const BOOTSTRAP_1 = Buffer.alloc(32, 1).toString("base64url")
const BOOTSTRAP_2 = Buffer.alloc(32, 2).toString("base64url")

async function fixture() {
	const createdAgent = await agent.createAgent({
		name: `Agent ${crypto.randomUUID()}`,
		systemPrompt: "System",
		wordBlacklist: [],
	})
	const createdEmbed = await embed.createEmbed({
		agentId: createdAgent.id,
		name: "Chat",
		appearance: DEFAULT_WIDGET_APPEARANCE,
	})
	return { createdAgent, createdEmbed }
}

function service(outputs: string[] = ["answer"], policy: { dailyLimit?: number; concurrencyLimit?: number } = {}) {
	let call = 0
	const prompts: unknown[] = []
	return {
		prompts,
		service: createConversationService({
			appSecret: APP_SECRET,
			dailyLimit: policy.dailyLimit ?? 100,
			concurrencyLimit: policy.concurrencyLimit ?? 2,
			maxInputCharacters: 400_000,
			maxOutputTokens: 100,
			timeoutMs: 10_000,
			generate: async function* (input) {
				prompts.push(input.messages)
				yield { type: "text", text: outputs[call] ?? "answer" } as const
				call += 1
				yield {
					type: "finish",
					outcome: "completed",
					provider: "fake",
					model: "fake-model",
					usage: { inputTokens: 8, outputTokens: 2 },
				} as const
			},
		}),
	}
}

function customService(
	generate: Parameters<typeof createConversationService>[0]["generate"],
	policy: { dailyLimit?: number; concurrencyLimit?: number } = {},
) {
	return createConversationService({
		appSecret: APP_SECRET,
		dailyLimit: policy.dailyLimit ?? 100,
		concurrencyLimit: policy.concurrencyLimit ?? 2,
		maxInputCharacters: 400_000,
		maxOutputTokens: 100,
		timeoutMs: 10_000,
		generate,
	})
}

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

async function* cancellationGeneration(input: { signal: AbortSignal }) {
	await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }))
	yield {
		type: "finish",
		outcome: "cancelled",
		provider: "fake",
		model: "fake-model",
		usage: {},
	} as const
}

async function* failingGeneration() {
	yield* []
	throw new Error("provider secret must not escape")
}

async function* emptyGeneration() {
	yield* []
}

async function* contextLimitGeneration() {
	yield* []
	throw new ProviderContextLimitError()
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE conversation_usage, conversation_message, conversation_attempt, conversation_session, conversation_daily_counter, conversation, embed, blacklist_word, agent CASCADE`
})

describe("conversation lifecycle", () => {
	it("recovers a first-send credential and isolates history", async () => {
		const { createdEmbed } = await fixture()
		const first = service()
		const accepted = await first.service.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "hello",
			networkHash: "network-a",
		})
		await accepted.done

		expect(
			await first.service.recoverBootstrap({
				embedToken: createdEmbed.embedToken,
				bootstrapSecret: BOOTSTRAP_1,
				requestId: REQUEST_1,
			}),
		).toEqual({ status: "accepted", credential: accepted.credential! })
		expect((await first.service.getSession(accepted.credential!)).messages.map((message) => message.text)).toEqual([
			"hello",
			"answer",
		])
		await expect(first.service.getSession("another-secret")).rejects.toBeInstanceOf(SessionUnauthorizedError)
	})

	it("deduplicates identical requests, rejects conflicting text, and sends complete history", async () => {
		const { createdEmbed } = await fixture()
		const instance = service(["one", "two"])
		const first = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})
		await first.done
		const duplicateEvents: { type: string }[] = []
		const duplicate = await instance.service.send(
			{
				credential: first.credential,
				requestId: REQUEST_1,
				text: "first",
				networkHash: "network-a",
			},
			(event) => duplicateEvents.push(event),
		)
		expect(duplicate.duplicate).toBe(true)
		expect(duplicateEvents.map((event) => event.type)).toEqual(["accepted", "terminal"])
		await expect(
			instance.service.send({
				credential: first.credential,
				requestId: REQUEST_1,
				text: "changed",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(RequestConflictError)

		const second = await instance.service.send({
			credential: first.credential,
			requestId: REQUEST_2,
			text: "second",
			networkHash: "network-a",
		})
		await second.done
		expect(instance.prompts[1]).toEqual([
			{ role: "system", content: "System" },
			{ role: "user", content: "first" },
			{ role: "assistant", content: "one" },
			{ role: "user", content: "second" },
		])
	})

	it("revokes sessions on embed rotation while preserving history and usage", async () => {
		const { createdEmbed } = await fixture()
		const instance = service()
		const sent = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "hello",
			networkHash: "network-a",
		})
		await sent.done
		await embed.rotateEmbedToken(createdEmbed.id)

		await expect(instance.service.getSession(sent.credential!)).rejects.toBeInstanceOf(SessionUnauthorizedError)
		expect((await sql`SELECT count(*)::int AS count FROM conversation`)[0]?.count).toBe(1)
		expect((await sql`SELECT input_tokens, output_tokens FROM conversation_usage`)[0]).toMatchObject({
			input_tokens: 8,
			output_tokens: 2,
		})
		const [storedUsage] = await sql`
			SELECT attempt_id, agent_id, conversation_id, provider, model, outcome, input_tokens, output_tokens
			FROM conversation_usage
		`
		if (!storedUsage) throw new Error("Expected persisted usage")
		await usage.recordUsage({
			attemptId: String(storedUsage.attempt_id),
			agentId: String(storedUsage.agent_id),
			conversationId: String(storedUsage.conversation_id),
			provider: String(storedUsage.provider),
			model: String(storedUsage.model),
			outcome: String(storedUsage.outcome),
			inputTokens: 999,
			outputTokens: 999,
		})
		expect((await sql`SELECT input_tokens, output_tokens FROM conversation_usage`)[0]).toMatchObject({
			input_tokens: 8,
			output_tokens: 2,
		})
	})

	it("enforces a daily allowance without recording usage for the rejected request", async () => {
		const { createdEmbed } = await fixture()
		const instance = service(["one", "two"], { dailyLimit: 1 })
		const first = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})
		await first.done

		await expect(
			instance.service.send({
				embedToken: createdEmbed.embedToken,
				bootstrapSecret: BOOTSTRAP_2,
				requestId: REQUEST_2,
				text: "second",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(DailyAllowanceExceededError)
		expect((await sql`SELECT count(*)::int AS count FROM conversation_usage`)[0]?.count).toBe(1)
	})

	it("shares concurrency reservations across service instances", async () => {
		const { createdEmbed } = await fixture()
		const gate = deferred()
		const generate = async function* () {
			await gate.promise
			yield {
				type: "finish",
				outcome: "completed",
				provider: "fake",
				model: "fake-model",
				usage: {},
			} as const
		}
		const firstInstance = customService(generate, { concurrencyLimit: 1 })
		const secondInstance = customService(generate, { concurrencyLimit: 1 })
		const first = await firstInstance.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})

		await expect(
			secondInstance.send({
				embedToken: createdEmbed.embedToken,
				bootstrapSecret: BOOTSTRAP_2,
				requestId: REQUEST_2,
				text: "second",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(ConcurrentGenerationLimitError)
		gate.resolve()
		await first.done
	})

	it("serializes duplicate bootstrap acceptance across networks and charges once", async () => {
		const { createdEmbed } = await fixture()
		const firstInstance = service().service
		const secondInstance = service().service
		const input = {
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "same",
		}
		const results = await Promise.all([
			firstInstance.send({ ...input, networkHash: "network-a" }),
			secondInstance.send({ ...input, networkHash: "network-b" }),
		])
		await Promise.all(results.map((result) => result.done))

		expect(results.filter((result) => result.duplicate)).toHaveLength(1)
		expect((await sql`SELECT count(*)::int AS count FROM conversation`)[0]?.count).toBe(1)
		expect((await sql`SELECT count(*)::int AS count FROM conversation_attempt`)[0]?.count).toBe(1)
		expect((await sql`SELECT count FROM conversation_daily_counter`)[0]?.count).toBe(1)
	})

	it("rejects concurrent bootstrap text conflicts without double charging", async () => {
		const { createdEmbed } = await fixture()
		const firstInstance = service().service
		const secondInstance = service().service
		const common = {
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
		}
		const results = await Promise.allSettled([
			firstInstance.send({ ...common, text: "first", networkHash: "network-a" }),
			secondInstance.send({ ...common, text: "conflict", networkHash: "network-b" }),
		])
		const accepted = results.find((result) => result.status === "fulfilled")
		if (accepted?.status === "fulfilled") await accepted.value.done

		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
		expect(results.find((result) => result.status === "rejected")).toMatchObject({
			reason: expect.any(RequestConflictError),
		})
		expect((await sql`SELECT count FROM conversation_daily_counter`)[0]?.count).toBe(1)
	})

	it("observes cancellation requested through another service instance", async () => {
		const { createdEmbed } = await fixture()
		const owner = customService(cancellationGeneration)
		const otherInstance = customService(cancellationGeneration)
		const sent = await owner.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "cancel me",
			networkHash: "network-a",
		})
		await otherInstance.cancel(sent.credential!, sent.generationId)
		await sent.done

		expect((await owner.getAttempt(sent.credential!, sent.generationId)).status).toBe("cancelled")
		expect((await sql`SELECT provider, model, input_tokens, output_tokens FROM conversation_usage`)[0]).toMatchObject({
			provider: "fake",
			model: "fake-model",
			input_tokens: expect.any(Number),
			output_tokens: expect.any(Number),
		})
	})

	it("sets embed references null and cascades all history and usage with agent deletion", async () => {
		const { createdAgent, createdEmbed } = await fixture()
		const instance = service()
		const sent = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "hello",
			networkHash: "network-a",
		})
		await sent.done
		await embed.deleteEmbed(createdEmbed.id)
		expect((await sql`SELECT embed_id FROM conversation`)[0]?.embed_id).toBeNull()
		expect((await sql`SELECT embed_id FROM conversation_session`)[0]?.embed_id).toBeNull()

		await agent.deleteAgent(createdAgent.id)
		const remaining = await sql`
			SELECT
				(SELECT count(*) FROM conversation)::int AS conversations,
				(SELECT count(*) FROM conversation_session)::int AS sessions,
				(SELECT count(*) FROM conversation_attempt)::int AS attempts,
				(SELECT count(*) FROM conversation_message)::int AS messages,
				(SELECT count(*) FROM conversation_usage)::int AS usage
		`
		expect(remaining[0]).toMatchObject({ conversations: 0, sessions: 0, attempts: 0, messages: 0, usage: 0 })
	})

	it("emits a typed error after acceptance when provider generation fails", async () => {
		const { createdEmbed } = await fixture()
		const instance = customService(failingGeneration)
		const events: { type: string }[] = []
		const sent = await instance.send(
			{
				embedToken: createdEmbed.embedToken,
				bootstrapSecret: BOOTSTRAP_1,
				requestId: REQUEST_1,
				text: "hello",
				networkHash: "network-a",
			},
			(event) => events.push(event),
		)
		await sent.done

		expect(events.map((event) => event.type)).toEqual(["accepted", "error"])
		expect(JSON.stringify(events)).not.toContain("provider secret")
	})

	it("cancels an accepted first send using only its private bootstrap identity", async () => {
		const { createdEmbed } = await fixture()
		const started = deferred()
		const generate = async function* (input: { signal: AbortSignal }) {
			started.resolve()
			await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }))
			yield {
				type: "finish",
				outcome: "cancelled",
				provider: "fake",
				model: "fake-model",
				usage: {},
			} as const
		}
		const owner = customService(generate)
		const otherInstance = customService(generate)
		const sent = await owner.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "cancel bootstrap",
			networkHash: "network-a",
		})
		await started.promise

		expect(
			await otherInstance.cancelBootstrap({
				embedToken: createdEmbed.embedToken,
				bootstrapSecret: BOOTSTRAP_1,
				requestId: REQUEST_1,
			}),
		).toBe("accepted")
		await sent.done
		expect((await owner.getAttempt(sent.credential!, sent.generationId)).status).toBe("cancelled")
		expect(
			await otherInstance.cancelBootstrap({
				embedToken: createdEmbed.embedToken,
				bootstrapSecret: BOOTSTRAP_2,
				requestId: REQUEST_2,
			}),
		).toBe("not-accepted")
		expect((await sql`SELECT count(*)::int AS count FROM conversation`)[0]?.count).toBe(1)
		await expect(
			otherInstance.cancelBootstrap({
				embedToken: createdEmbed.embedToken,
				bootstrapSecret: BOOTSTRAP_2,
				requestId: REQUEST_1,
			}),
		).rejects.toBeInstanceOf(SessionUnauthorizedError)
	})

	it("serializes concurrent sends for one session even when network keys differ", async () => {
		const { createdEmbed } = await fixture()
		const gate = deferred()
		let calls = 0
		const instance = customService(async function* () {
			calls += 1
			if (calls > 1) await gate.promise
			yield {
				type: "finish",
				outcome: "completed",
				provider: "fake",
				model: "fake-model",
				usage: {},
			} as const
		})
		const initial = await instance.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "initial",
			networkHash: "network-a",
		})
		await initial.done

		const results = await Promise.allSettled([
			instance.send({ credential: initial.credential, requestId: REQUEST_2, text: "one", networkHash: "network-a" }),
			instance.send({ credential: initial.credential, requestId: REQUEST_3, text: "two", networkHash: "network-b" }),
		])
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
		const rejected = results.find((result) => result.status === "rejected")
		expect(rejected).toMatchObject({ reason: expect.any(SessionBusyError) })
		gate.resolve()
		const accepted = results.find((result) => result.status === "fulfilled")
		if (accepted?.status === "fulfilled") await accepted.value.done
	})

	it("recovers an expired lease, records interrupted usage once, and fences late work", async () => {
		const { createdEmbed } = await fixture()
		const started = deferred()
		const gate = deferred()
		const owner = customService(async function* () {
			started.resolve()
			yield { type: "start", provider: "fake", model: "fake-model" } as const
			await gate.promise
			yield { type: "text", text: "late" } as const
			yield {
				type: "finish",
				outcome: "completed",
				provider: "fake",
				model: "fake-model",
				usage: { inputTokens: 9, outputTokens: 1 },
			} as const
		})
		const sent = await owner.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "recover",
			networkHash: "network-a",
		})
		await started.promise
		await sql`UPDATE conversation_attempt SET lease_expires_at = now() - interval '1 second' WHERE id = ${sent.generationId}`

		await customService(emptyGeneration).getSession(sent.credential!)
		gate.resolve()
		await sent.done
		const state = await owner.getAttempt(sent.credential!, sent.generationId)
		expect(state).toMatchObject({ status: "interrupted", assistantText: "" })
		expect(
			(await sql`SELECT count(*)::int AS count FROM conversation_usage WHERE attempt_id = ${sent.generationId}`)[0]
				?.count,
		).toBe(1)
		expect(await repository.appendOutput(sent.generationId, "stale-lease", "overwrite")).toBe(false)
		const next = await service().service.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_2,
			requestId: REQUEST_2,
			text: "after recovery",
			networkHash: "network-a",
		})
		await next.done
	})

	it("keeps usage idempotent and resolves late completion safely after agent deletion", async () => {
		const { createdAgent, createdEmbed } = await fixture()
		const started = deferred()
		const gate = deferred()
		const instance = customService(async function* () {
			started.resolve()
			yield { type: "start", provider: "fake", model: "fake-model" } as const
			await gate.promise
			yield { type: "finish", outcome: "completed", provider: "fake", model: "fake-model", usage: {} } as const
		})
		const sent = await instance.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "delete",
			networkHash: "network-a",
		})
		await started.promise
		await embed.deleteEmbed(createdEmbed.id)
		await agent.deleteAgent(createdAgent.id)
		gate.resolve()
		await expect(sent.done).resolves.toBeUndefined()
	})

	it("maps provider context limits differently for fresh and established conversations", async () => {
		const { createdEmbed } = await fixture()
		const errors: { error?: { code: string; newChatAvailable: boolean }; type: string }[] = []
		const fresh = customService(contextLimitGeneration)
		const first = await fresh.send(
			{
				embedToken: createdEmbed.embedToken,
				bootstrapSecret: BOOTSTRAP_1,
				requestId: REQUEST_1,
				text: "fresh",
				networkHash: "network-a",
			},
			(event) => errors.push(event),
		)
		await first.done
		expect(errors.at(-1)).toMatchObject({ error: { code: "chat-input-incompatible", newChatAvailable: false } })
	})

	it("offers a new chat when an established conversation exceeds the provider context", async () => {
		const { createdEmbed } = await fixture()
		let calls = 0
		const instance = customService(async function* () {
			calls += 1
			if (calls > 1) throw new ProviderContextLimitError()
			yield { type: "finish", outcome: "completed", provider: "fake", model: "fake", usage: {} } as const
		})
		const first = await instance.send({
			embedToken: createdEmbed.embedToken,
			bootstrapSecret: BOOTSTRAP_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})
		await first.done
		const events: { error?: { code: string; newChatAvailable: boolean }; type: string }[] = []
		const second = await instance.send(
			{ credential: first.credential, requestId: REQUEST_2, text: "second", networkHash: "network-a" },
			(event) => events.push(event),
		)
		await second.done

		expect(events.at(-1)).toMatchObject({ error: { code: "chat-context-limit", newChatAvailable: true } })
	})
})
