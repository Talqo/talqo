import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import { ProviderContextLimitError, type TextMessage } from "@/modules/ai-provider/ai-provider.service.ts"
import * as embed from "@/modules/embed/embed.service.ts"
import * as usage from "@/modules/usage/usage.service.ts"
import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test"

import {
	ConcurrentGenerationLimitError,
	ConversationTooLongError,
	DailyAllowanceExceededError,
	ProviderUnavailableError,
	RequestConflictError,
	SessionBusyError,
	SessionUnauthorizedError,
} from "./conversation.errors.ts"
import * as repository from "./conversation.repository.ts"
import { createConversationService, getConversationService } from "./conversation.service.ts"

const REQUEST_1 = "11111111-1111-4111-8111-111111111111"
const REQUEST_2 = "22222222-2222-4222-8222-222222222222"
const REQUEST_3 = "33333333-3333-4333-8333-333333333333"
const CREDENTIAL_1 = "44444444-4444-4444-8444-444444444444"
const CREDENTIAL_2 = "55555555-5555-4555-8555-555555555555"

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
	const prompts: TextMessage[][] = []
	return {
		prompts,
		service: createConversationService({
			dailyLimit: policy.dailyLimit ?? 100,
			concurrencyLimit: policy.concurrencyLimit ?? 2,
			maxInputCharacters: 400_000,
			maxOutputTokens: 100,
			timeoutMs: 10_000,
			prepare: async (input) => ({
				provider: "fake",
				model: "fake-model",
				invoke: async function* () {
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
		}),
	}
}

function customService(
	generate: (input: {
		maxOutputTokens: number
		messages: TextMessage[]
		signal: AbortSignal
		timeoutMs: number
	}) => AsyncIterable<
		| { model: string; provider: string; type: "start" }
		| { text: string; type: "text" }
		| {
				model: string
				outcome: "cancelled" | "completed" | "failed" | "interrupted"
				provider: string
				type: "finish"
				usage: usage.ProviderUsage
		  }
	>,
	policy: { dailyLimit?: number; concurrencyLimit?: number } = {},
	beforeAccept?: (attempt: number) => Promise<void>,
) {
	return createConversationService({
		dailyLimit: policy.dailyLimit ?? 100,
		concurrencyLimit: policy.concurrencyLimit ?? 2,
		maxInputCharacters: 400_000,
		maxOutputTokens: 100,
		timeoutMs: 10_000,
		...(beforeAccept ? { beforeAccept } : {}),
		prepare: async (input) => ({
			provider: "fake",
			model: "fake-model",
			invoke: (signal) => generate({ ...input, signal }),
		}),
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

async function* emptyGeneration() {}

async function* contextLimitGeneration() {
	yield* []
	throw new ProviderContextLimitError()
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE usage_record, message, generation_attempt, conversation_daily_counter, conversation, embed, blacklist_word, agent CASCADE`
})

afterEach(() => {
	setSystemTime()
})

describe("conversation lifecycle", () => {
	it("creates a bearer-authenticated conversation and isolates history", async () => {
		const { createdEmbed } = await fixture()
		const first = service()
		const accepted = await first.service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "hello",
			networkHash: "network-a",
		})
		await accepted.done

		expect((await sql`SELECT id, embed_access_version FROM conversation`)[0]).toMatchObject({
			id: CREDENTIAL_1,
			embed_access_version: createdEmbed.accessVersion,
		})
		expect((await first.service.getSession(CREDENTIAL_1)).messages.map((message) => message.text)).toEqual([
			"hello",
			"answer",
		])
		await expect(first.service.getSession(CREDENTIAL_2)).rejects.toBeInstanceOf(SessionUnauthorizedError)
		await expect(
			first.service.send({
				embedToken: createdEmbed.embedToken,
				credential: "66666666-6666-1666-8666-666666666666",
				requestId: REQUEST_2,
				text: "predictable credential",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(SessionUnauthorizedError)
	})

	it("deduplicates identical requests, rejects conflicting text, and sends complete history", async () => {
		const { createdEmbed } = await fixture()
		const instance = service(["one", "two"])
		const first = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})
		await first.done
		const duplicateEvents: { type: string }[] = []
		const duplicate = await instance.service.send(
			{
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
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
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "changed",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(RequestConflictError)

		const second = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_2,
			text: "second",
			networkHash: "network-a",
		})
		await second.done
		const systemPrompt = instance.prompts[1]?.[0]
		expect(systemPrompt).toMatchObject({ role: "system" })
		expect(systemPrompt?.content).toMatch(/\S\nSystem$/)
		expect(instance.prompts[1]?.slice(1)).toEqual([
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
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "hello",
			networkHash: "network-a",
		})
		await sent.done
		await embed.rotateEmbedToken(createdEmbed.id)

		await expect(instance.service.getSession(CREDENTIAL_1)).rejects.toBeInstanceOf(SessionUnauthorizedError)
		expect((await sql`SELECT count(*)::int AS count FROM conversation`)[0]?.count).toBe(1)
		expect((await sql`SELECT input_tokens, output_tokens FROM usage_record`)[0]).toMatchObject({
			input_tokens: 8,
			output_tokens: 2,
		})
		const [storedUsage] = await sql`
			SELECT generation_attempt_id, agent_id, conversation_id, provider, model, outcome, input_tokens, output_tokens
			FROM usage_record
		`
		if (!storedUsage) throw new Error("Expected persisted usage")
		const usageRecord = {
			generationAttemptId: String(storedUsage.generation_attempt_id),
			agentId: String(storedUsage.agent_id),
			conversationId: String(storedUsage.conversation_id),
			provider: String(storedUsage.provider),
			model: String(storedUsage.model),
			outcome: String(storedUsage.outcome),
			inputTokens: Number(storedUsage.input_tokens),
			outputTokens: Number(storedUsage.output_tokens),
		}
		await expect(usage.recordUsage(usageRecord)).resolves.toBeUndefined()
		await expect(usage.recordUsage({ ...usageRecord, inputTokens: 999, outputTokens: 999 })).rejects.toBeDefined()
		expect((await sql`SELECT input_tokens, output_tokens FROM usage_record`)[0]).toMatchObject({
			input_tokens: 8,
			output_tokens: 2,
		})
	})

	it("enforces a daily allowance without recording usage for the rejected request", async () => {
		const { createdEmbed } = await fixture()
		const instance = service(["one", "two"], { dailyLimit: 1 })
		const first = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})
		await first.done

		await expect(
			instance.service.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_2,
				requestId: REQUEST_2,
				text: "second",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(DailyAllowanceExceededError)
		expect((await sql`SELECT count(*)::int AS count FROM usage_record`)[0]?.count).toBe(1)
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
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})

		await expect(
			secondInstance.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_2,
				requestId: REQUEST_2,
				text: "second",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(ConcurrentGenerationLimitError)
		gate.resolve()
		await first.done
	})

	it("serializes duplicate first-send acceptance across networks and charges once", async () => {
		const { createdEmbed } = await fixture()
		const firstInstance = service().service
		const secondInstance = service().service
		const input = {
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
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
		expect((await sql`SELECT count(*)::int AS count FROM generation_attempt`)[0]?.count).toBe(1)
		expect((await sql`SELECT count FROM conversation_daily_counter`)[0]?.count).toBe(1)
	})

	it("rejects concurrent first-send text conflicts without double charging", async () => {
		const { createdEmbed } = await fixture()
		const firstInstance = service().service
		const secondInstance = service().service
		const common = {
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
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
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "cancel me",
			networkHash: "network-a",
		})
		await otherInstance.cancel(CREDENTIAL_1, sent.generationId)
		await sent.done

		expect(
			(await owner.getSession(CREDENTIAL_1)).messages.find((message) => message.id === sent.assistantMessage.id)
				?.outcome,
		).toBe("cancelled")
		expect((await sql`SELECT provider, model, input_tokens, output_tokens FROM usage_record`)[0]).toMatchObject({
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
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "hello",
			networkHash: "network-a",
		})
		await sent.done
		await embed.deleteEmbed(createdEmbed.id)
		expect((await sql`SELECT embed_id FROM conversation`)[0]?.embed_id).toBeNull()

		await agent.deleteAgent(createdAgent.id)
		const remaining = await sql`
			SELECT
				(SELECT count(*) FROM conversation)::int AS conversations,
				(SELECT count(*) FROM generation_attempt)::int AS generation_attempts,
				(SELECT count(*) FROM message)::int AS messages,
				(SELECT count(*) FROM usage_record)::int AS usage_records
		`
		expect(remaining[0]).toMatchObject({ conversations: 0, generation_attempts: 0, messages: 0, usage_records: 0 })
	})

	it("emits a typed error after acceptance when provider generation fails", async () => {
		const { createdEmbed } = await fixture()
		const instance = customService(failingGeneration)
		const events: { type: string }[] = []
		const sent = await instance.send(
			{
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
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

	it("cancels an accepted first send through another service instance", async () => {
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
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "cancel first send",
			networkHash: "network-a",
		})
		await started.promise

		await otherInstance.cancel(CREDENTIAL_1, sent.generationId)
		await sent.done
		expect(
			(await owner.getSession(CREDENTIAL_1)).messages.find((message) => message.id === sent.assistantMessage.id)
				?.outcome,
		).toBe("cancelled")
		expect((await sql`SELECT count(*)::int AS count FROM conversation`)[0]?.count).toBe(1)
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
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "initial",
			networkHash: "network-a",
		})
		await initial.done

		const results = await Promise.allSettled([
			instance.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_2,
				text: "one",
				networkHash: "network-a",
			}),
			instance.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_3,
				text: "two",
				networkHash: "network-b",
			}),
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
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "recover",
			networkHash: "network-a",
		})
		await started.promise
		await sql`UPDATE generation_attempt SET lease_expires_at = now() - interval '1 second' WHERE id = ${sent.generationId}`

		await customService(emptyGeneration).getSession(CREDENTIAL_1)
		gate.resolve()
		await sent.done
		const assistantMessage = (await owner.getSession(CREDENTIAL_1)).messages.find(
			(message) => message.id === sent.assistantMessage.id,
		)
		expect(assistantMessage).toMatchObject({ outcome: "interrupted", text: "" })
		expect(
			(await sql`SELECT count(*)::int AS count FROM usage_record WHERE generation_attempt_id = ${sent.generationId}`)[0]
				?.count,
		).toBe(1)
		expect(
			(
				await sql`
					SELECT ga.final_outcome, ga.usage_input_tokens, ga.usage_output_tokens,
						ga.usage_recorded_at IS NOT NULL AS recorded, ur.outcome,
						ur.input_tokens, ur.output_tokens
					FROM generation_attempt ga
					JOIN usage_record ur ON ur.generation_attempt_id = ga.id
					WHERE ga.id = ${sent.generationId}
				`
			)[0],
		).toMatchObject({
			final_outcome: "interrupted",
			outcome: "interrupted",
			recorded: true,
			usage_input_tokens: expect.any(Number),
			usage_output_tokens: expect.any(Number),
			input_tokens: expect.any(Number),
			output_tokens: expect.any(Number),
		})
		expect(await repository.appendOutput(sent.generationId, "stale-lease", "overwrite")).toBe(false)
		const next = await service().service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_2,
			requestId: REQUEST_2,
			text: "after recovery",
			networkHash: "network-a",
		})
		await next.done
	})

	it("uses PostgreSQL time for lease lifecycle decisions when the process clock is skewed", async () => {
		const { createdEmbed } = await fixture()
		const started = deferred()
		const gate = deferred()
		const instance = customService(async function* () {
			yield { type: "start", provider: "fake", model: "fake-model" } as const
			started.resolve()
			await gate.promise
			yield { type: "finish", outcome: "completed", provider: "fake", model: "fake-model", usage: {} } as const
		})
		setSystemTime(new Date("2000-01-01T00:00:00.000Z"))
		const sent = await instance.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "database clock",
			networkHash: "network-a",
		})
		await started.promise
		const [generationAttempt] = await sql`
			SELECT lease_token, conversation_id FROM generation_attempt WHERE id = ${sent.generationId}
		`
		const leaseToken = String(generationAttempt?.lease_token)
		const conversationId = String(generationAttempt?.conversation_id)

		setSystemTime(new Date("2100-01-01T00:00:00.000Z"))
		expect(await repository.heartbeat(sent.generationId, leaseToken)).toBe(true)
		expect(await repository.setAttribution(sent.generationId, leaseToken, "database", "clock")).toBe(true)
		expect(await repository.getActiveGenerationAttempt(conversationId)).toEqual({ id: sent.generationId })
		expect(await repository.requestCancellation(conversationId, sent.generationId)).toBe(true)
		expect(await repository.isCancellationRequested(sent.generationId, leaseToken)).toBe(true)
		await repository.recoverExpiredGenerationAttempts()
		expect(
			(
				await sql`
					SELECT status,
						lease_expires_at BETWEEN now() + interval '10 seconds' AND now() + interval '20 seconds' AS lease_uses_db_time,
						updated_at BETWEEN now() - interval '5 seconds' AND now() + interval '1 second' AS update_uses_db_time
					FROM generation_attempt
					WHERE id = ${sent.generationId}
				`
			)[0],
		).toMatchObject({ status: "running", lease_uses_db_time: true, update_uses_db_time: true })

		gate.resolve()
		await sent.done
	})

	it("keeps a provider completion when cancellation occurs while its iterator closes", async () => {
		const { createdEmbed } = await fixture()
		const exiting = deferred()
		const release = deferred()
		const instance = customService(async function* () {
			try {
				yield { type: "finish", outcome: "completed", provider: "fake", model: "fake-model", usage: {} } as const
			} finally {
				exiting.resolve()
				await release.promise
			}
		})
		const events: { outcome?: string; type: string }[] = []
		const sent = await instance.send(
			{
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "complete",
				networkHash: "network-a",
			},
			(event) => events.push(event),
		)
		await exiting.promise
		await instance.cancel(CREDENTIAL_1, sent.generationId)
		release.resolve()
		await sent.done

		expect(events.at(-1)).toMatchObject({ type: "terminal", outcome: "completed" })
		expect(
			(await instance.getSession(CREDENTIAL_1)).messages.find((message) => message.id === sent.assistantMessage.id),
		).toMatchObject({ outcome: "completed" })
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
			credential: CREDENTIAL_1,
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
				credential: CREDENTIAL_1,
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
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})
		await first.done
		const events: { error?: { code: string; newChatAvailable: boolean }; type: string }[] = []
		const second = await instance.send(
			{
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_2,
				text: "second",
				networkHash: "network-a",
			},
			(event) => events.push(event),
		)
		await second.done

		expect(events.at(-1)).toMatchObject({ error: { code: "chat-context-limit", newChatAvailable: true } })
	})

	it("rejects every worker write after its lease expires", async () => {
		const { createdEmbed } = await fixture()
		const started = deferred()
		const gate = deferred()
		const instance = customService(async function* () {
			started.resolve()
			yield { type: "start", provider: "fake", model: "fake-model" } as const
			await gate.promise
		})
		const sent = await instance.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "expire",
			networkHash: "network-a",
		})
		await started.promise
		const [generationAttempt] = await sql`SELECT lease_token FROM generation_attempt WHERE id = ${sent.generationId}`
		const leaseToken = String(generationAttempt?.lease_token)
		await sql`
			UPDATE generation_attempt
			SET cancellation_requested_at = now(), lease_expires_at = now() - interval '1 second'
			WHERE id = ${sent.generationId}
		`

		expect(await repository.heartbeat(sent.generationId, leaseToken)).toBe(false)
		expect(await repository.setAttribution(sent.generationId, leaseToken, "late", "late")).toBe(false)
		expect(await repository.appendOutput(sent.generationId, leaseToken, "late")).toBe(false)
		expect(await repository.isCancellationRequested(sent.generationId, leaseToken)).toBe(false)
		expect(
			await repository.stageFinalization({
				generationAttemptId: sent.generationId,
				leaseToken,
				outcome: "completed",
				provider: "late",
				model: "late",
				inputTokens: 1,
				outputTokens: 1,
			}),
		).toBe(false)
		gate.resolve()
		await sent.done
	})

	it("atomically interrupts an expired generation attempt before admitting its replacement", async () => {
		const { createdEmbed } = await fixture()
		const started = deferred()
		const gate = deferred()
		const owner = customService(async function* () {
			started.resolve()
			yield { type: "start", provider: "fake", model: "fake-model" } as const
			await gate.promise
			yield { type: "finish", outcome: "completed", provider: "fake", model: "fake-model", usage: {} } as const
		})
		const expired = await owner.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "expires",
			networkHash: "network-a",
		})
		await started.promise
		await sql`UPDATE generation_attempt SET lease_expires_at = now() - interval '1 second' WHERE id = ${expired.generationId}`

		const replacement = await service().service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_2,
			text: "replacement",
			networkHash: "network-a",
		})
		expect((await sql`SELECT status FROM generation_attempt WHERE id = ${expired.generationId}`)[0]?.status).toBe(
			"interrupted",
		)
		gate.resolve()
		await Promise.all([expired.done, replacement.done])
	})

	it("persists a short safe tail when generation fails", async () => {
		const { createdEmbed } = await fixture()
		const instance = customService(async function* () {
			yield { type: "start", provider: "fake", model: "fake-model" } as const
			yield { type: "text", text: "tiny" } as const
			throw new Error("failed")
		})
		const sent = await instance.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "fail",
			networkHash: "network-a",
		})
		await sent.done

		expect(
			(await instance.getSession(CREDENTIAL_1)).messages.find((message) => message.id === sent.assistantMessage.id)
				?.text,
		).toBe("tiny")
		expect((await sql`SELECT output_tokens FROM usage_record`)[0]?.output_tokens).toBe(1)
	})

	it("persists a short safe tail when generation is cancelled", async () => {
		const { createdEmbed } = await fixture()
		const started = deferred()
		const instance = customService(async function* (input) {
			yield { type: "start", provider: "fake", model: "fake-model" } as const
			yield { type: "text", text: "tiny" } as const
			started.resolve()
			await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }))
			yield { type: "finish", outcome: "cancelled", provider: "fake", model: "fake-model", usage: {} } as const
		})
		const sent = await instance.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "cancel",
			networkHash: "network-a",
		})
		await started.promise
		await instance.cancel(CREDENTIAL_1, sent.generationId)
		await sent.done

		expect(
			(await instance.getSession(CREDENTIAL_1)).messages.find((message) => message.id === sent.assistantMessage.id)
				?.text,
		).toBe("tiny")
		expect((await sql`SELECT output_tokens FROM usage_record`)[0]?.output_tokens).toBe(1)
	})

	it("rejects unusable provider configuration before acceptance without charging or creating data", async () => {
		const { createdEmbed } = await fixture()
		await sql`DELETE FROM ai_provider_config`

		await expect(
			getConversationService().send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "must not accept",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(ProviderUnavailableError)
		const [counts] = await sql`
			SELECT
				(SELECT count(*) FROM conversation)::int AS conversations,
				(SELECT count(*) FROM generation_attempt)::int AS generation_attempts,
				(SELECT count(*) FROM conversation_daily_counter)::int AS allowance,
				(SELECT count(*) FROM usage_record)::int AS usage_records
		`
		expect(counts).toMatchObject({ conversations: 0, generation_attempts: 0, allowance: 0, usage_records: 0 })
	})

	it("recreates usage from durable finalization state after a crash before insertion", async () => {
		const { createdEmbed } = await fixture()
		const instance = service()
		const sent = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "durable",
			networkHash: "network-a",
		})
		await sent.done
		await sql`DELETE FROM usage_record WHERE generation_attempt_id = ${sent.generationId}`
		await sql`UPDATE generation_attempt SET usage_recorded_at = NULL WHERE id = ${sent.generationId}`

		await instance.service.getSession(CREDENTIAL_1)

		expect((await sql`SELECT outcome, input_tokens, output_tokens FROM usage_record`)[0]).toMatchObject({
			outcome: "completed",
			input_tokens: 8,
			output_tokens: 2,
		})
		expect((await sql`SELECT usage_recorded_at IS NOT NULL AS recorded FROM generation_attempt`)[0]?.recorded).toBe(
			true,
		)
		await sql`UPDATE generation_attempt SET usage_recorded_at = NULL WHERE id = ${sent.generationId}`
		await instance.service.getSession(CREDENTIAL_1)
		expect((await sql`SELECT count(*)::int AS count FROM usage_record`)[0]?.count).toBe(1)
		expect((await sql`SELECT usage_recorded_at IS NOT NULL AS recorded FROM generation_attempt`)[0]?.recorded).toBe(
			true,
		)
	})

	it("reloads full completed history when a turn completes after the optimistic snapshot", async () => {
		const { createdEmbed } = await fixture()
		const initialService = service(["initial"]).service
		const initial = await initialService.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "first",
			networkHash: "network-a",
		})
		await initial.done
		const rival = service(["raced"]).service
		const prompts: TextMessage[][] = []
		const main = customService(
			async function* (input) {
				prompts.push(input.messages)
				yield { type: "finish", outcome: "completed", provider: "fake", model: "fake-model", usage: {} } as const
			},
			{},
			async (attempt) => {
				if (attempt !== 0) return
				const raced = await rival.send({
					embedToken: createdEmbed.embedToken,
					credential: CREDENTIAL_1,
					requestId: REQUEST_2,
					text: "racing turn",
					networkHash: "network-a",
				})
				await raced.done
			},
		)

		const sent = await main.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_3,
			text: "after race",
			networkHash: "network-a",
		})
		await sent.done

		expect(prompts).toHaveLength(1)
		expect(prompts[0]?.[0]?.content).toMatch(/\S\nSystem$/)
		expect(prompts[0]?.slice(1)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "initial" },
			{ role: "user", content: "racing turn" },
			{ role: "assistant", content: "raced" },
			{ role: "user", content: "after race" },
		])
		expect((await sql`SELECT count FROM conversation_daily_counter`)[0]?.count).toBe(3)
	})

	it("rejects an over-long conversation without consuming allowance and keeps it readable", async () => {
		const { createdEmbed } = await fixture()
		const instance = service(["short"], { dailyLimit: 2 })
		const input = { embedToken: createdEmbed.embedToken, credential: CREDENTIAL_1, networkHash: "network-a" }
		const first = await instance.service.send({ ...input, requestId: REQUEST_1, text: "hi" })
		await first.done

		await expect(
			instance.service.send({ ...input, requestId: REQUEST_2, text: "x".repeat(400_000) }),
		).rejects.toBeInstanceOf(ConversationTooLongError)

		// A daily limit of 2 makes a spuriously consumed allowance visible: the next valid send must pass.
		const followUp = await instance.service.send({ ...input, requestId: REQUEST_2, text: "still fine" })
		await followUp.done
		const session = await instance.service.getSession(CREDENTIAL_1)
		expect(session.messages.map((message) => [message.role, message.outcome])).toEqual([
			["user", "completed"],
			["assistant", "completed"],
			["user", "completed"],
			["assistant", "completed"],
		])
	})

	it("excludes incomplete turns from subsequent model input without duplicating a retried message", async () => {
		const createdAgent = await agent.createAgent({
			name: `Agent ${crypto.randomUUID()}`,
			systemPrompt: "System",
			wordBlacklist: ["poison"],
		})
		const createdEmbed = await embed.createEmbed({
			agentId: createdAgent.id,
			name: "Chat",
			appearance: DEFAULT_WIDGET_APPEARANCE,
		})
		const outputs = ["fine", "lost", "poison", "afterwards", "again"]
		const calls: TextMessage[][] = []
		let call = 0
		const svc = customService(async function* (input) {
			calls.push(input.messages)
			const mine = call
			call += 1
			if (mine === 1) throw new Error("provider exploded")
			yield { type: "text", text: outputs[mine] ?? "again" }
			yield {
				type: "finish",
				outcome: "completed",
				provider: "fake",
				model: "fake-model",
				usage: {},
			} as const
		})
		const input = { embedToken: createdEmbed.embedToken, credential: CREDENTIAL_1, networkHash: "network-a" }
		for (const text of ["first", "repeat me", "trigger", "follow up", "repeat me"]) {
			// oxlint-disable-next-line no-await-in-loop -- turns must complete in order.
			const sent = await svc.send({ ...input, requestId: crypto.randomUUID(), text })
			// oxlint-disable-next-line no-await-in-loop
			await sent.done
		}

		// The failed pair and the blacklist-blocked pair are both excluded; completed pairs resend in full.
		expect(calls[3]?.slice(1)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "fine" },
			{ role: "user", content: "follow up" },
		])
		// Retrying the failed question starts a new turn; the failed user message appears exactly once.
		expect(calls[4]?.slice(1).filter((message) => message.content === "repeat me")).toHaveLength(1)
		expect(calls[4]?.slice(1)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "fine" },
			{ role: "user", content: "follow up" },
			{ role: "assistant", content: "afterwards" },
			{ role: "user", content: "repeat me" },
		])
	})
})
