import type { Annotation } from "@/http/wide-event.ts"

import { app } from "@/app.ts"
import { sql } from "@/db/client.ts"
import * as agent from "@/modules/agent/agent.service.ts"
import {
	type AiProviderId,
	ProviderContextLimitError,
	type TextMessage,
} from "@/modules/ai-provider/ai-provider.service.ts"
import * as embed from "@/modules/embed/embed.service.ts"
import * as identity from "@/modules/identity/identity.service.ts"
import * as knowledgeRepository from "@/modules/knowledge-base/knowledge-base.repository.ts"
import * as knowledge from "@/modules/knowledge-base/knowledge-base.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import * as usage from "@/modules/usage/usage.service.ts"
import { DEFAULT_PASSWORD, giveRole, testAdminId, uniqueUsername } from "@/test-helpers.ts"
import { DEFAULT_WIDGET_APPEARANCE } from "@talqo/shared/widget-appearance"
import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test"

import {
	ConcurrentGenerationLimitError,
	ConversationNotFoundError,
	ConversationTooLongError,
	DailyAllowanceExceededError,
	EmbedDisabledError,
	ProviderUnavailableError,
	RequestConflictError,
	SessionBusyError,
	SessionUnauthorizedError,
} from "./conversation.errors.ts"
import * as repository from "./conversation.repository.ts"
import {
	CONVERSATION_PAGE_SIZE,
	createConversationService,
	getConversationService,
	getConversationTranscript,
	listConversations,
} from "./conversation.service.ts"

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
	const createdEmbed = await embed.createEmbed(
		{
			agentId: createdAgent.id,
			name: "Chat",
			appearance: DEFAULT_WIDGET_APPEARANCE,
		},
		await testAdminId(),
	)
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
				provider: "openai-compatible",
				model: "fake-model",
				invoke: async function* () {
					prompts.push(input.messages)
					yield { type: "text", text: outputs[call] ?? "answer" } as const
					call += 1
					yield {
						type: "finish",
						outcome: "completed",
						provider: "openai-compatible",
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
		| { model: string; provider: AiProviderId; type: "start" }
		| { text: string; type: "text" }
		| {
				model: string
				outcome: "cancelled" | "completed" | "failed" | "interrupted"
				provider: AiProviderId
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
			provider: "openai-compatible",
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
		provider: "openai-compatible",
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

async function seedReadyChunk(agentId: string): Promise<void> {
	await knowledgeRepository.enqueue(agentId, "guide.md")
	const job = await knowledgeRepository.claim("test-key")
	if (!job) throw new Error("Expected an ingestion job")
	await knowledgeRepository.complete(job, "test-key", [{ text: "seeded fact", embedding: [1, 0, 0] }])
}

beforeEach(async () => {
	await sql`TRUNCATE TABLE usage_record, message, generation_attempt, conversation_daily_counter, conversation, embed, blacklist_word, agent CASCADE`
})

afterEach(() => {
	setSystemTime()
})

describe("conversation lifecycle", () => {
	it("prunes expired allowance rows in bounded batches without deleting today's counters", async () => {
		const { createdAgent, createdEmbed } = await fixture()
		await sql`INSERT INTO conversation_daily_counter (agent_id, network_hash, day, count)
			SELECT ${createdAgent.id}, 'expired-' || n::text, '2000-01-01', 1 FROM generate_series(1, 1001) AS n`
		await sql`INSERT INTO conversation_daily_counter (agent_id, network_hash, day, count)
			VALUES (${createdAgent.id}, 'preserved', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 1)`
		const instance = service()
		const sent = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "hello",
			networkHash: "network-a",
		})
		await sent.done
		expect(
			(await sql`SELECT count(*)::int AS count FROM conversation_daily_counter WHERE day = '2000-01-01'`)[0]?.count,
		).toBe(1)
		expect((await sql`SELECT count FROM conversation_daily_counter WHERE network_hash = 'preserved'`)[0]?.count).toBe(1)
	})

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

	it("rejects messages to a disabled embed without charging and resumes after re-enable", async () => {
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
		await embed.disableEmbed(createdEmbed.id, await testAdminId())

		await expect(
			instance.service.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_2,
				text: "still there?",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(EmbedDisabledError)
		await expect(
			instance.service.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_2,
				requestId: REQUEST_3,
				text: "new visitor",
				networkHash: "network-a",
			}),
		).rejects.toBeInstanceOf(EmbedDisabledError)
		expect((await sql`SELECT count(*)::int AS count FROM generation_attempt`)[0]?.count).toBe(1)
		expect((await sql`SELECT count(*)::int AS count FROM conversation_daily_counter`)[0]?.count).toBe(1)

		await embed.enableEmbed(createdEmbed.id, await testAdminId())
		const resumed = await instance.service.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_2,
			text: "still there?",
			networkHash: "network-a",
		})
		await resumed.done
		expect((await instance.service.getSession(CREDENTIAL_1)).messages.map((message) => message.text)).toEqual([
			"hello",
			"answer",
			"still there?",
			"answer",
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
		await embed.rotateEmbedToken(createdEmbed.id, await testAdminId())

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
				provider: "openai-compatible",
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
		const conflicted = results.find((result) => result.status === "rejected")
		if (conflicted?.status !== "rejected") throw new Error("expected a rejected send")
		expect(conflicted.reason as RequestConflictError).toBeInstanceOf(RequestConflictError)
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
		const usageRows = (await sql`SELECT provider, model, input_tokens, output_tokens FROM usage_record`) as [
			{ provider: string; model: string; input_tokens: number; output_tokens: number },
		]
		expect(usageRows[0]).toMatchObject({ provider: "openai-compatible", model: "fake-model" })
		expect(typeof usageRows[0]?.input_tokens).toBe("number")
		expect(typeof usageRows[0]?.output_tokens).toBe("number")
	})

	it("checks locally owned generations together and observes cross-instance cancellation", async () => {
		const { createdEmbed } = await fixture()
		const owner = customService(cancellationGeneration)
		const other = customService(cancellationGeneration)
		const poll = spyOn(repository, "pollRunningAttempts")
		try {
			const first = await owner.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "first",
				networkHash: "network-a",
			})
			const second = await owner.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_2,
				requestId: REQUEST_2,
				text: "second",
				networkHash: "network-b",
			})
			await other.cancel(CREDENTIAL_2, second.generationId)
			await second.done
			// Intentional: batching both owned generations into one poll is the contract under test.
			expect(poll.mock.calls.some(([owned]) => owned.length === 2)).toBe(true)
			await owner.cancel(CREDENTIAL_1, first.generationId)
			await first.done
		} finally {
			poll.mockRestore()
		}
	})

	it("keeps a generation alive across one failed poll and observes a later cancellation", async () => {
		const { createdEmbed } = await fixture()
		const owner = customService(cancellationGeneration)
		const other = customService(cancellationGeneration)
		const realPoll = repository.pollRunningAttempts
		let attempts = 0
		const poll = spyOn(repository, "pollRunningAttempts").mockImplementation((owned, renew) => {
			attempts += 1
			if (attempts === 1) throw new Error("temporary poll failure")
			return realPoll(owned, renew)
		})
		const logged = spyOn(console, "error").mockImplementation(() => undefined)
		try {
			const sent = await owner.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "keep generating",
				networkHash: "network-a",
			})
			await other.cancel(CREDENTIAL_1, sent.generationId)
			await sent.done
			expect(attempts).toBeGreaterThanOrEqual(2)
			expect((await owner.getSession(CREDENTIAL_1)).messages.at(-1)?.outcome).toBe("cancelled")
			expect(logged.mock.calls.filter(([event]) => event === "conversation.poll.failed")).toHaveLength(1)
		} finally {
			poll.mockRestore()
			logged.mockRestore()
		}
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
		await embed.deleteEmbed(createdEmbed.id, await testAdminId())
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
				provider: "openai-compatible",
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
				provider: "openai-compatible",
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
		if (rejected?.status !== "rejected") throw new Error("expected a rejected send")
		expect(rejected.reason as SessionBusyError).toBeInstanceOf(SessionBusyError)
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
			yield { type: "start", provider: "openai-compatible", model: "fake-model" } as const
			await gate.promise
			yield { type: "text", text: "late" } as const
			yield {
				type: "finish",
				outcome: "completed",
				provider: "openai-compatible",
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
		const [persistedAttempt] = await sql`
			SELECT estimated_input_tokens FROM generation_attempt WHERE id = ${sent.generationId}
		`
		const estimatedInputTokens = Number(persistedAttempt?.estimated_input_tokens)
		expect(estimatedInputTokens).toBeGreaterThan(0)
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
		const usageRows = (await sql`
			SELECT ga.final_outcome, ga.usage_input_tokens, ga.usage_output_tokens,
				ga.usage_recorded_at IS NOT NULL AS recorded, ur.outcome,
				ur.input_tokens, ur.output_tokens
			FROM generation_attempt ga
			JOIN usage_record ur ON ur.generation_attempt_id = ga.id
			WHERE ga.id = ${sent.generationId}
		`) as [
			{
				final_outcome: string
				outcome: string
				recorded: boolean
				usage_input_tokens: number
				usage_output_tokens: number
				input_tokens: number
				output_tokens: number
			},
		]
		expect(usageRows[0]).toMatchObject({
			final_outcome: "interrupted",
			outcome: "interrupted",
			recorded: true,
			usage_input_tokens: estimatedInputTokens,
			input_tokens: estimatedInputTokens,
		})
		expect(typeof usageRows[0]?.usage_output_tokens).toBe("number")
		expect(typeof usageRows[0]?.output_tokens).toBe("number")
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
			yield { type: "start", provider: "openai-compatible", model: "fake-model" } as const
			started.resolve()
			await gate.promise
			yield {
				type: "finish",
				outcome: "completed",
				provider: "openai-compatible",
				model: "fake-model",
				usage: {},
			} as const
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
		expect(await repository.pollRunningAttempts([{ id: sent.generationId, leaseToken }], true)).toEqual([
			{ id: sent.generationId, cancelled: false },
		])
		expect(await repository.setAttribution(sent.generationId, leaseToken, "database", "clock")).toBe(true)
		expect(await repository.getActiveGenerationAttempt(conversationId)).toEqual({ id: sent.generationId })
		expect(await repository.requestCancellation(conversationId, sent.generationId)).toEqual([sent.generationId])
		expect(await repository.pollRunningAttempts([{ id: sent.generationId, leaseToken }], false)).toEqual([
			{ id: sent.generationId, cancelled: true },
		])
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
				yield {
					type: "finish",
					outcome: "completed",
					provider: "openai-compatible",
					model: "fake-model",
					usage: {},
				} as const
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
			yield { type: "start", provider: "openai-compatible", model: "fake-model" } as const
			await gate.promise
			yield {
				type: "finish",
				outcome: "completed",
				provider: "openai-compatible",
				model: "fake-model",
				usage: {},
			} as const
		})
		const sent = await instance.send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "delete",
			networkHash: "network-a",
		})
		await started.promise
		await embed.deleteEmbed(createdEmbed.id, await testAdminId())
		await agent.deleteAgent(createdAgent.id)
		gate.resolve()
		await expect(sent.done).resolves.toBeUndefined()
	})

	it("rejects a fresh conversation over the provider context without offering a new chat", async () => {
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
			yield { type: "finish", outcome: "completed", provider: "openai-compatible", model: "fake", usage: {} } as const
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
			yield { type: "start", provider: "openai-compatible", model: "fake-model" } as const
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

		expect(await repository.pollRunningAttempts([{ id: sent.generationId, leaseToken }], true)).toEqual([])
		expect(await repository.setAttribution(sent.generationId, leaseToken, "late", "late")).toBe(false)
		expect(await repository.appendOutput(sent.generationId, leaseToken, "late")).toBe(false)
		expect(await repository.pollRunningAttempts([{ id: sent.generationId, leaseToken }], false)).toEqual([])
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
			yield { type: "start", provider: "openai-compatible", model: "fake-model" } as const
			await gate.promise
			yield {
				type: "finish",
				outcome: "completed",
				provider: "openai-compatible",
				model: "fake-model",
				usage: {},
			} as const
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
			yield { type: "start", provider: "openai-compatible", model: "fake-model" } as const
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

	it("persists many small safe deltas in fewer writes before emitting them", async () => {
		const { createdEmbed } = await fixture()
		const append = spyOn(repository, "appendOutput")
		try {
			const instance = customService(async function* () {
				for (let index = 0; index < 40; index += 1) yield { type: "text", text: "x" } as const
				yield { type: "text", text: "y".repeat(2_048) } as const
				yield {
					type: "finish",
					outcome: "completed",
					provider: "openai-compatible",
					model: "fake-model",
					usage: {},
				} as const
			})
			const events: { type: string; text?: string }[] = []
			const sent = await instance.send(
				{
					embedToken: createdEmbed.embedToken,
					credential: CREDENTIAL_1,
					requestId: REQUEST_1,
					text: "batch",
					networkHash: "network-a",
				},
				(event) => events.push(event),
			)
			await sent.done
			// Intentional: fewer writes than deltas plus the chunk cap is the batching contract under test.
			expect(append.mock.calls.length).toBeLessThan(40)
			expect(append.mock.calls.every(([, , text]) => text.length <= 1_024)).toBe(true)
			expect(
				events
					.filter((event) => event.type === "delta")
					.map((event) => event.text)
					.join(""),
			).toBe("x".repeat(40) + "y".repeat(2_048))
			expect(events.at(-1)?.type).toBe("terminal")
			expect((await instance.getSession(CREDENTIAL_1)).messages.at(-1)?.text).toBe("x".repeat(40) + "y".repeat(2_048))
		} finally {
			append.mockRestore()
		}
	})

	it("flushes a short safe delta while the provider is still generating", async () => {
		const { createdEmbed } = await fixture()
		const observed = deferred()
		const instance = customService(async function* ({ signal }) {
			yield { type: "text", text: "hello" } as const
			await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
			yield {
				type: "finish",
				outcome: "cancelled",
				provider: "openai-compatible",
				model: "fake-model",
				usage: {},
			} as const
		})
		const sent = await instance.send(
			{
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "stream",
				networkHash: "network-a",
			},
			(event) => {
				if (event.type === "delta") observed.resolve()
			},
		)
		await observed.promise
		expect((await sql`SELECT text FROM message WHERE id = ${sent.assistantMessage.id}`)[0]?.text).toBe("hello")
		await instance.cancel(CREDENTIAL_1, sent.generationId)
		await sent.done
	})

	it("persists a short safe tail when generation is cancelled", async () => {
		const { createdEmbed } = await fixture()
		const started = deferred()
		const instance = customService(async function* (input) {
			yield { type: "start", provider: "openai-compatible", model: "fake-model" } as const
			yield { type: "text", text: "tiny" } as const
			started.resolve()
			await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }))
			yield {
				type: "finish",
				outcome: "cancelled",
				provider: "openai-compatible",
				model: "fake-model",
				usage: {},
			} as const
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
		const [savedConfig] = (await sql`
			SELECT id, revision, text_config, embedding_config, created_at, updated_at FROM ai_provider_config
		`) as [
			{
				id: string
				revision: number
				text_config: unknown
				embedding_config: unknown
				created_at: Date
				updated_at: Date
			}?,
		]
		try {
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
		} finally {
			if (savedConfig) {
				await sql`INSERT INTO ai_provider_config (id, revision, text_config, embedding_config, created_at, updated_at)
					VALUES (${savedConfig.id}, ${savedConfig.revision}, ${JSON.stringify(savedConfig.text_config)}::jsonb, ${JSON.stringify(savedConfig.embedding_config)}::jsonb, ${savedConfig.created_at}, ${savedConfig.updated_at})
					ON CONFLICT (id) DO NOTHING`
			}
		}
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

		await service().service.getSession(CREDENTIAL_1)

		expect((await sql`SELECT outcome, input_tokens, output_tokens FROM usage_record`)[0]).toMatchObject({
			outcome: "completed",
			input_tokens: 8,
			output_tokens: 2,
		})
		expect((await sql`SELECT usage_recorded_at IS NOT NULL AS recorded FROM generation_attempt`)[0]?.recorded).toBe(
			true,
		)
		await sql`UPDATE generation_attempt SET usage_recorded_at = NULL WHERE id = ${sent.generationId}`
		await service().service.getSession(CREDENTIAL_1)
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
				yield {
					type: "finish",
					outcome: "completed",
					provider: "openai-compatible",
					model: "fake-model",
					usage: {},
				} as const
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

		const fields: Annotation = {}
		await expect(
			instance.service.send({ ...input, requestId: REQUEST_2, text: "x".repeat(400_000) }, undefined, (annotation) =>
				Object.assign(fields, annotation),
			),
		).rejects.toBeInstanceOf(ConversationTooLongError)
		expect(fields).toMatchObject({ "chat.new_conversation": false })
		expect(fields["chat.prompt_characters"]).toBeGreaterThan(400_000)

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
		const createdEmbed = await embed.createEmbed(
			{
				agentId: createdAgent.id,
				name: "Chat",
				appearance: DEFAULT_WIDGET_APPEARANCE,
			},
			await testAdminId(),
		)
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
				provider: "openai-compatible",
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

		expect(calls[3]?.slice(1)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "fine" },
			{ role: "user", content: "follow up" },
		])
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

describe("chat retrieval", () => {
	it("holds the existing concurrency slot while retrieval is pending", async () => {
		const { createdEmbed } = await fixture()
		const instance = service(["answer"], { concurrencyLimit: 1 })
		const started = Promise.withResolvers<void>()
		const release = Promise.withResolvers<string[]>()
		const search = spyOn(knowledge, "searchKnowledge").mockImplementation(async () => {
			started.resolve()
			return release.promise
		})
		try {
			const sent = await instance.service.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "hello",
				networkHash: "network-a",
			})
			try {
				await started.promise
				await expect(
					instance.service.send({
						embedToken: createdEmbed.embedToken,
						credential: CREDENTIAL_2,
						requestId: REQUEST_2,
						text: "hello",
						networkHash: "network-a",
					}),
				).rejects.toBeInstanceOf(ConcurrentGenerationLimitError)
				expect(search).toHaveBeenCalledTimes(1)
			} finally {
				release.resolve([])
				await sent.done
			}
		} finally {
			search.mockRestore()
		}
	})

	it("cancels retrieval and finalizes without charging text-provider usage", async () => {
		const { createdEmbed } = await fixture()
		const instance = service()
		const started = Promise.withResolvers<void>()
		const search = spyOn(knowledge, "searchKnowledge").mockImplementation(async (_agentId, _text, signal) => {
			if (!signal) throw new Error("Expected retrieval cancellation signal")
			started.resolve()
			return new Promise<string[]>((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
			)
		})
		try {
			const sent = await instance.service.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "hello",
				networkHash: "network-a",
			})
			await started.promise
			await instance.service.cancel(CREDENTIAL_1, sent.generationId)
			await sent.done
			expect(instance.prompts).toEqual([])
			expect((await instance.service.getSession(CREDENTIAL_1)).messages.at(-1)?.outcome).toBe("cancelled")
			expect((await sql`SELECT count(*)::int AS count FROM usage_record`)[0]?.count).toBe(0)
		} finally {
			search.mockRestore()
		}
	})

	it("finalizes oversized retrieved context without invoking the text provider", async () => {
		const { createdEmbed } = await fixture()
		const instance = service()
		const search = spyOn(knowledge, "searchKnowledge").mockResolvedValue(["x".repeat(400_001)])
		try {
			const sent = await instance.service.send({
				embedToken: createdEmbed.embedToken,
				credential: CREDENTIAL_1,
				requestId: REQUEST_1,
				text: "hello",
				networkHash: "network-a",
			})
			await sent.done
			expect(instance.prompts).toEqual([])
			expect((await instance.service.getSession(CREDENTIAL_1)).messages.at(-1)?.outcome).toBe("failed")
			expect((await sql`SELECT count(*)::int AS count FROM usage_record`)[0]?.count).toBe(0)
			expect((await sql`SELECT status, provider_invoked FROM generation_attempt`)[0]).toMatchObject({
				status: "failed",
				provider_invoked: false,
			})
		} finally {
			search.mockRestore()
		}
	})

	it("reserves the existing allowance before retrieval and skips retrieval for rejected requests and retries", async () => {
		const { createdEmbed } = await fixture()
		const instance = service(["answer"], { dailyLimit: 1 })
		const search = spyOn(knowledge, "searchKnowledge").mockResolvedValue(["context"])
		const input = {
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_1,
			text: "hello",
			networkHash: "network-a",
		}
		try {
			const first = await instance.service.send(input)
			await first.done
			expect((await instance.service.send(input)).duplicate).toBe(true)
			expect(search).toHaveBeenCalledTimes(1)
			await expect(instance.service.send({ ...input, requestId: REQUEST_2 })).rejects.toBeInstanceOf(
				DailyAllowanceExceededError,
			)
			await embed.disableEmbed(createdEmbed.id, await testAdminId())
			search.mockClear()
			await expect(instance.service.send({ ...input, requestId: REQUEST_3 })).rejects.toBeInstanceOf(EmbedDisabledError)
			expect(search).not.toHaveBeenCalled()
		} finally {
			search.mockRestore()
		}
	})

	it("injects retrieved chunks into the user message", async () => {
		const { createdAgent, createdEmbed } = await fixture()
		const instance = service()
		const search = spyOn(knowledge, "searchKnowledge").mockResolvedValue(["refund policy: 30 days"])
		const fields: Annotation = {}
		try {
			const sent = await instance.service.send(
				{
					embedToken: createdEmbed.embedToken,
					credential: CREDENTIAL_1,
					requestId: REQUEST_1,
					text: "what is the refund policy",
					networkHash: "network-a",
				},
				undefined,
				(annotation) => Object.assign(fields, annotation),
			)
			await sent.done
			const { "chat.prompt_characters": promptCharacters, ...rest } = fields
			expect(promptCharacters).toBeGreaterThan(0)
			expect(rest).toEqual({
				"agent.id": createdAgent.id,
				"embed.id": createdEmbed.id,
				"chat.duplicate": false,
				"chat.request_id": REQUEST_1,
				"chat.new_conversation": true,
				"rag.chunks": 1,
				"rag.degraded": false,
				"mcp.servers_degraded": 0,
				"gen_ai.provider.name": "openai-compatible",
				"gen_ai.response.model": "fake-model",
				"gen_ai.usage.input_tokens": 8,
				"gen_ai.usage.output_tokens": 2,
			})
			const systemPrompt = instance.prompts[0]?.[0]
			expect(systemPrompt).toMatchObject({ role: "system" })
			expect(systemPrompt?.content).toMatch(/\S\nSystem$/)
			const question = instance.prompts[0]?.at(-1)
			expect(question).toMatchObject({ role: "user" })
			expect(question?.content).toContain("refund policy: 30 days")
			expect(question?.content).toContain("only if relevant")
			expect(question?.content).toContain("what is the refund policy")
			expect((await instance.service.getSession(CREDENTIAL_1)).messages.map((message) => message.text)).toEqual([
				"what is the refund policy",
				"answer",
			])
		} finally {
			search.mockRestore()
		}
	})

	it("proceeds without context when retrieval throws", async () => {
		const { createdAgent, createdEmbed } = await fixture()
		await seedReadyChunk(createdAgent.id)
		const instance = service()
		const search = spyOn(knowledge, "searchKnowledge").mockRejectedValue(new Error("embedding down"))
		const logged = spyOn(console, "error").mockImplementation(() => undefined)
		const fields: Annotation = {}
		try {
			const sent = await instance.service.send(
				{
					embedToken: createdEmbed.embedToken,
					credential: CREDENTIAL_1,
					requestId: REQUEST_1,
					text: "hello",
					networkHash: "network-a",
				},
				undefined,
				(annotation) => Object.assign(fields, annotation),
			)
			await sent.done
			expect(fields).toMatchObject({ "rag.degraded": true })
			expect(fields).not.toHaveProperty("rag.chunks")
			expect((await instance.service.getSession(CREDENTIAL_1)).messages.map((message) => message.text)).toEqual([
				"hello",
				"answer",
			])
			expect(logged).toHaveBeenCalledWith("knowledge-base.retrieval.degraded", expect.anything())
		} finally {
			search.mockRestore()
			logged.mockRestore()
		}
	})

	it("emits an error event instead of rejecting when finalization fails", async () => {
		const { createdEmbed } = await fixture()
		const instance = service()
		using _ = spyOn(repository, "stageFinalization").mockRejectedValue(new Error("database down"))
		const events: { type: string }[] = []
		const sent = await instance.service.send(
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

		expect(events.map((event) => event.type)).toEqual(["accepted", "delta", "error"])
	})
})

async function chat(embedToken: string, credential: string, text: string): Promise<void> {
	const sent = await service().service.send({
		embedToken,
		credential,
		requestId: crypto.randomUUID(),
		text,
		networkHash: "network-a",
	})
	await sent.done
}

async function operatorSession(permission?: roles.GrantablePermission | roles.AgentPermission): Promise<string> {
	const username = uniqueUsername()
	const account = await identity.createUser({ username, password: DEFAULT_PASSWORD })
	if (permission) await giveRole(account.id, [permission])
	const response = await app.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password: DEFAULT_PASSWORD }),
	})
	const cookie = response.headers.get("set-cookie")?.split(";")[0]
	if (!cookie) throw new Error("Expected a session cookie")
	return cookie
}

function pageOfTwo(offset: number) {
	return repository.listConversations({
		agentIds: undefined,
		limit: 2,
		offset,
		previewLength: 10,
	})
}

describe("operator conversation reads", () => {
	it("lists conversations across agents newest first with previews, counts and owners", async () => {
		const first = await fixture()
		const second = await fixture()
		await chat(first.createdEmbed.embedToken, CREDENTIAL_1, "first visitor")
		await chat(first.createdEmbed.embedToken, CREDENTIAL_1, "follow-up")
		await chat(second.createdEmbed.embedToken, CREDENTIAL_2, "x".repeat(500))

		const page = await listConversations({ page: 1 }, await testAdminId())

		expect(page).toMatchObject({ page: 1, pageSize: CONVERSATION_PAGE_SIZE, total: 2 })
		expect(page.conversations.map((item) => [item.agentId, item.messageCount, item.preview?.length])).toEqual([
			[second.createdAgent.id, 2, 160],
			[first.createdAgent.id, 4, "first visitor".length],
		])
		expect(page.conversations.map((item) => item.id)).not.toContain(CREDENTIAL_1)
	})

	it("filters conversations and transcripts by scoped read access, including explicit agent filters", async () => {
		const first = await fixture()
		const second = await fixture()
		await chat(first.createdEmbed.embedToken, CREDENTIAL_1, "mine")
		await chat(second.createdEmbed.embedToken, CREDENTIAL_2, "theirs")

		const operator = await identity.createUser({ username: uniqueUsername(), password: DEFAULT_PASSWORD })
		await giveRole(operator.id, ["conversations:read"], [first.createdAgent.id])
		const page = await listConversations({ page: 1 }, operator.id)
		expect(page.total).toBe(1)
		expect(page.conversations.map((item) => item.preview)).toEqual(["mine"])
		expect((await listConversations({ agentId: [first.createdAgent.id], page: 1 }, operator.id)).total).toBe(1)
		expect((await listConversations({ agentId: [second.createdAgent.id], page: 1 }, operator.id)).total).toBe(0)
		const all = await listConversations({ page: 1 }, await testAdminId())
		const hidden = all.conversations.find((item) => item.agentId === second.createdAgent.id)
		if (!hidden) throw new Error("Missing hidden conversation")
		await expect(getConversationTranscript(hidden.id, operator.id)).rejects.toMatchObject({
			status: 404,
			problemCode: "conversation-not-found",
		})
		const { token } = await identity.createSession(operator.id)
		const headers = { Cookie: `${identity.SESSION_COOKIE}=${token}` }
		const hiddenResponse = await app.request(`/api/conversations/${hidden.id}`, { headers })
		const missingResponse = await app.request(`/api/conversations/${crypto.randomUUID()}`, { headers })
		expect(hiddenResponse.status).toBe(404)
		expect(await hiddenResponse.json()).toEqual(await missingResponse.json())
		await giveRole(operator.id, ["stats:read"], [first.createdAgent.id])
		await expect(listConversations({ page: 1 }, operator.id)).rejects.toMatchObject({ status: 403 })
	})

	it("pages by offset without skipping or repeating conversations", async () => {
		const { createdEmbed } = await fixture()
		for (const text of ["one", "two", "three"]) {
			// oxlint-disable-next-line no-await-in-loop -- start order defines the expected page order.
			await chat(createdEmbed.embedToken, crypto.randomUUID(), text)
		}

		const [firstPage, secondPage] = await Promise.all([pageOfTwo(0), pageOfTwo(2)])

		expect([...firstPage.rows, ...secondPage.rows].map((row) => row.preview)).toEqual(["three", "two", "one"])
		expect([firstPage.total, secondPage.total]).toEqual([3, 3])
	})

	it("returns a transcript and shows an abandoned reply as interrupted", async () => {
		const { createdAgent, createdEmbed } = await fixture()
		await chat(createdEmbed.embedToken, CREDENTIAL_1, "hello")
		const gate = deferred()
		const abandoned = await customService(async function* () {
			yield { type: "start", provider: "openai-compatible", model: "fake-model" } as const
			await gate.promise
		}).send({
			embedToken: createdEmbed.embedToken,
			credential: CREDENTIAL_1,
			requestId: REQUEST_2,
			text: "still there?",
			networkHash: "network-a",
		})
		await sql`UPDATE generation_attempt SET lease_expires_at = now() - interval '1 second' WHERE id = ${abandoned.generationId}`
		const [summary] = (await listConversations({ page: 1 }, await testAdminId())).conversations
		if (!summary) throw new Error("Expected a conversation")

		const transcript = await getConversationTranscript(summary.id, await testAdminId())
		gate.resolve()
		await abandoned.done

		expect(transcript.agentId).toBe(createdAgent.id)
		expect(transcript.messages.map((item) => [item.role, item.text, item.outcome])).toEqual([
			["user", "hello", "completed"],
			["assistant", "answer", "completed"],
			["user", "still there?", "completed"],
			["assistant", "", "interrupted"],
		])
		await expect(getConversationTranscript(crypto.randomUUID(), await testAdminId())).rejects.toBeInstanceOf(
			ConversationNotFoundError,
		)
	})

	it("serves conversations over HTTP to conversations:read without exposing the visitor credential", async () => {
		const { createdAgent, createdEmbed } = await fixture()
		await chat(createdEmbed.embedToken, CREDENTIAL_1, "hello")
		const cookie = await operatorSession(roles.AgentPermission.ConversationsRead)
		const get = (path: string) => app.request(`/api/conversations${path}`, { headers: { Cookie: cookie } })

		const list = await get(`?agentId=${createdAgent.id}`)
		const listBody = await list.text()
		const id = (JSON.parse(listBody) as { conversations: { id: string }[] }).conversations[0]?.id
		const transcript = await get(`/${id}`)
		const missing = await get(`/${crypto.randomUUID()}`)
		const otherAgents = await get(`?agentId=${crypto.randomUUID()}&agentId=${crypto.randomUUID()}`)
		const invalid = await get("?page=0")

		expect(list.status).toBe(200)
		expect(listBody).not.toContain(CREDENTIAL_1)
		expect(JSON.parse(listBody)).toMatchObject({ total: 1, page: 1 })
		expect(transcript.status).toBe(200)
		expect(await transcript.text()).not.toContain(CREDENTIAL_1)
		expect(missing.status).toBe(404)
		expect(await missing.json()).toMatchObject({ code: "conversation-not-found" })
		expect(await otherAgents.json()).toMatchObject({ conversations: [], total: 0 })
		expect(invalid.status).toBe(400)
		expect(await invalid.json()).toMatchObject({ code: "invalid-request" })
	})

	it("denies operators who can see agents but not conversations", async () => {
		const { createdAgent, createdEmbed } = await fixture()
		await chat(createdEmbed.embedToken, CREDENTIAL_1, "private conversation")
		const cookie = await operatorSession(roles.AgentPermission.AgentRead)
		const headers = { Cookie: cookie }
		expect((await app.request(`/api/agents/${createdAgent.id}`, { headers })).status).toBe(200)
		const [conversation] = (await listConversations({ page: 1 }, await testAdminId())).conversations
		if (!conversation) throw new Error("Missing conversation")
		const transcript = await app.request(`/api/conversations/${conversation.id}`, { headers })
		expect(transcript.status).toBe(403)
		expect(await transcript.json()).toMatchObject({ code: "permission-denied" })

		const response = await app.request("/api/conversations", { headers })

		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ code: "permission-denied" })
	})
})
