import { db } from "@/db/client.ts"
import { estimateTokens } from "@/modules/usage/usage.service.ts"
import { like } from "drizzle-orm"

import type { MessagePart } from "./conversation.messages.ts"

import { conversation, generationAttempt, type GenerationAttemptOutcome, message } from "./conversation.schema.ts"

// Development traffic fixtures: a month of varied daily conversations per seeded agent plus two
// recent ones, so dashboard statistics render realistic series out of the box. Returns the seeded
// attempts so the usage seed can meter them.
const DAYS = 30
const MARKER_PREFIX = "seed-stats-"
const MILLISECONDS_PER_SECOND = 1000
const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_HOUR = 3_600_000
const MILLISECONDS_PER_DAY = 86_400_000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const ACTIVE_MINUTES_AGO = 12
const RECENT_CONVERSATION_COUNT = 2
const RECENT_CONVERSATION_STAGGER_MINUTES = 7
const RECENT_CONVERSATION_SEED = 0x5e_ed
const SYSTEM_PROMPT_TOKENS = 360
const TOOL_SCHEMA_TOKENS = 180
const UUID_NODE_DIGITS = 12
const TRANSCRIPT_ANSWER_DELAY_MS = 2400
const TRANSCRIPT_ANSWER_DELAY_STEP_MS = 350
const ANSWER_DELAY_MIN_MS = 1800
const ANSWER_DELAY_MAX_MS = 9000
const TURN_GAP_MIN_SECONDS = 20
const TURN_GAP_MAX_SECONDS = 180
const WEEKEND_FACTOR = 0.45
const GROWTH_FLOOR = 0.75
const GROWTH_RANGE = 0.5
const NOISE_FLOOR = 0.4
const NOISE_RANGE = 1.2
const QUIET_DAY_CHANCE = 0.08
const SATURDAY_DAY_INDEX = 6
const SPIKE_CHANCE = 0.12
const SPIKE_FACTOR = 1.7
const RANDOM_INCREMENT = 0x6d_2b_79_f5
const RANDOM_HASH_X = 0x9e_37_79_b1
const RANDOM_HASH_Y = 0x85_eb_ca_6b
const RANDOM_MIX_PRIME = 61
const RANDOM_SHIFT_WIDE = 15
const RANDOM_SHIFT_NARROW = 7
const RANDOM_SHIFT_FINAL = 14
const RANDOM_UINT32_RANGE = 4_294_967_296

type SeedToolCall = {
	errorText?: string
	input: unknown
	outcome?: "completed" | "failed" | "interrupted"
	output?: unknown
	serverName?: string
	source: "client" | "mcp"
	toolName: string
}

type SeedQa = {
	answer: string
	question: string
	tools?: ReadonlyArray<SeedToolCall>
}

const WEBSITE_QA: ReadonlyArray<SeedQa> = [
	{
		question: "Where can I see your pricing tiers?",
		answer: "Every plan is listed on the **pricing page**. Monthly and yearly billing include the same features.",
	},
	{
		question: "How do I reset my password?",
		answer: "Open **Account → Security** and choose *Reset password*. The reset link arrives within a minute.",
	},
	{
		question: "Is there an API for the analytics data?",
		answer:
			"Yes. The public API exposes the analytics endpoints, and the docs include pagination and request examples.",
	},
	{
		question: "Can I export my conversation history?",
		answer: "You can export a conversation as **JSON** or **CSV** from its menu in the dashboard.",
	},
	{
		question: "What is the difference between the two plans?",
		answer:
			"**Growth** adds five websites and priority support. **Business** removes the website limit and adds a dedicated contact.",
	},
	{
		question: "Do you support single sign-on?",
		answer: "Single sign-on is available on **Business**. We support SAML and OIDC.",
	},
	{
		question: "How long does shipping to Germany take?",
		answer: "Orders to Germany usually arrive in **3–5 business days**, and the tracking link is sent by email.",
	},
	{
		question: "Can I change the delivery address after ordering?",
		tools: [
			{
				source: "mcp",
				serverName: "Shop inventory",
				toolName: "list_orders",
				input: { status: "processing" },
				output: { orders: [{ id: "#1042", status: "processing" }] },
			},
		],
		answer:
			"Order **#1042** is still processing, so we can update it. Reply to the confirmation email with the new address.",
	},
	{
		question: "Is the blue mug in stock?",
		tools: [
			{
				source: "mcp",
				serverName: "Shop inventory",
				toolName: "get_stock_level",
				input: { sku: "MUG-BLUE" },
				output: { sku: "MUG-BLUE", available: 42 },
			},
		],
		answer: "The **blue mug** has **42 units** left and ships today when ordered before 15:00.",
	},
	{
		question: "Can you add the blue mug to my cart?",
		tools: [
			{
				source: "client",
				toolName: "add_to_cart",
				input: { sku: "MUG-BLUE", quantity: 1 },
				output: { cartCount: 3 },
			},
		],
		answer: "Done — one **blue mug** is in your cart. Open the cart when you are ready to check out.",
	},
	{
		question: "Where is my last order?",
		tools: [
			{
				source: "mcp",
				serverName: "Shop inventory",
				toolName: "list_orders",
				input: { limit: 1 },
				output: { orders: [{ id: "#1039", status: "shipped" }] },
			},
		],
		answer: "Your last order **#1039** shipped on Monday and should arrive **tomorrow**.",
	},
	{
		question: "Can you open the pricing page?",
		tools: [{ source: "client", toolName: "open_page", input: { path: "/pricing" }, output: { opened: true } }],
		answer: "I opened the **pricing page** for you.",
	},
]

const PRODUCT_QA: ReadonlyArray<SeedQa> = [
	{
		question: "Which plan fits a small shop?",
		answer: "For a small shop, **Starter** covers one website and email support. You can move up without losing data.",
	},
	{
		question: "What is included in Growth?",
		answer: "**Growth** includes five websites, priority support, and the analytics API.",
	},
	{
		question: "Can I switch plans later?",
		answer: "Yes. Upgrades apply immediately, and downgrades take effect at the next billing date.",
	},
	{
		question: "Do you have a plan for agencies?",
		answer: "Agencies usually start on **Business**, because it has no website limit and includes a dedicated contact.",
	},
	{
		question: "Is the black mug in stock?",
		tools: [
			{
				source: "client",
				toolName: "read_product",
				input: { sku: "MUG-BLACK" },
				output: { sku: "MUG-BLACK", available: 7 },
			},
		],
		answer: "The **black mug** has **7 units** left, so it is a good gift pick while stock lasts.",
	},
	{
		question: "What does priority support include?",
		answer: "Priority support answers within **four business hours** on weekdays, including configuration help.",
	},
	{
		question: "Do you offer yearly discounts?",
		answer: "Yearly billing saves **two months** compared with paying monthly.",
	},
	{
		question: "Can you add the travel mug to my cart?",
		tools: [
			{
				source: "client",
				toolName: "add_to_cart",
				input: { sku: "MUG-TRAVEL", quantity: 2 },
				output: { cartCount: 2 },
			},
		],
		answer: "I added **two travel mugs** to your cart.",
	},
]

const DOCS_QA: ReadonlyArray<SeedQa> = [
	{
		question: "How do I install the SDK?",
		answer: "Install it with `bun add @talqo/sdk`, then create a client with your embed token.",
	},
	{
		question: "Where is the API reference?",
		answer: "The API reference lives under **Docs → API** and lists every endpoint with request examples.",
	},
	{
		question: "How do I rotate an embed token?",
		answer:
			"Open the embed settings, choose **Rotate token**, and update your snippet. The old token stops working immediately.",
	},
	{
		question: "What are the rate limits?",
		answer: "The default limit is **100 messages per day** per embed and two concurrent generations per IP address.",
	},
	{
		question: "How do I self-host Talqo?",
		answer:
			"Run the API and PostgreSQL containers from the repository. The deployment guide covers migrations and backups.",
	},
	{
		question: "Can I use my own model provider?",
		answer: "Yes. Add a provider in **AI configuration**, then pick the model per agent.",
	},
	{
		question: "How does RAG work?",
		answer:
			"Talqo splits uploaded documents into chunks, embeds them, and retrieves the closest chunks for each question.",
	},
]

const SEED_AGENTS = [
	{ agentId: "11111111-1111-4111-8111-111111111111", basePerDay: 8, questions: WEBSITE_QA }, // Website Assistant
	{ agentId: "33333333-3333-4333-8333-333333333333", basePerDay: 5, questions: PRODUCT_QA }, // Product Advisor
	{ agentId: "44444444-4444-4444-8444-444444444444", basePerDay: 2.5, questions: DOCS_QA }, // Docs Assistant
] as const

// Start times cluster around two business-hour peaks and stay quiet overnight.
const HOURS_PER_DAY = 24
const MORNING_PEAK_HOUR = 10
const AFTERNOON_PEAK_HOUR = 15
const PEAK_HOUR_WEIGHT = 17
const NIGHT_HOUR_WEIGHT = 0.5
const MAX_TURNS_PER_CONVERSATION = 4

function hourWeight(hour: number): number {
	const morningDistance = hour - MORNING_PEAK_HOUR
	const afternoonDistance = hour - AFTERNOON_PEAK_HOUR
	const weight =
		PEAK_HOUR_WEIGHT / (1 + morningDistance * morningDistance) +
		PEAK_HOUR_WEIGHT / (1 + afternoonDistance * afternoonDistance)
	return Math.max(NIGHT_HOUR_WEIGHT, weight)
}

const HOUR_WEIGHTS = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hourWeight(hour))
const HOUR_WEIGHT_TOTAL = HOUR_WEIGHTS.reduce((total, weight) => total + weight, 0)

export type SeededAttempt = {
	generationAttemptId: string
	agentId: string
	conversationId: string
	inputTokens: number
	outputTokens: number
	outcome: GenerationAttemptOutcome
	createdAt: Date
}

export type PlannedRows = {
	conversations: Array<typeof conversation.$inferInsert & { createdAt: Date }>
	attempts: Array<typeof generationAttempt.$inferInsert & { usageRecordedAt: Date }>
	messages: Array<typeof message.$inferInsert & { createdAt: Date }>
	usages: Array<SeededAttempt>
}

function mulberry32(initialState: number): () => number {
	let state = initialState >>> 0
	return () => {
		state = (state + RANDOM_INCREMENT) >>> 0
		let value = state
		value = Math.imul(value ^ (value >>> RANDOM_SHIFT_WIDE), value | 1)
		value ^= value + Math.imul(value ^ (value >>> RANDOM_SHIFT_NARROW), value | RANDOM_MIX_PRIME)
		return ((value ^ (value >>> RANDOM_SHIFT_FINAL)) >>> 0) / RANDOM_UINT32_RANGE
	}
}

function dayRandom(agentIndex: number, daysAgo: number): () => number {
	return mulberry32(((agentIndex + 1) * RANDOM_HASH_X) ^ ((daysAgo + 1) * RANDOM_HASH_Y))
}

function between(random: () => number, minimum: number, maximum: number): number {
	return minimum + Math.floor(random() * (maximum - minimum + 1))
}

function shuffled<T>(random: () => number, items: ReadonlyArray<T>): Array<T> {
	const copy = [...items]
	for (let index = copy.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1))
		const current = copy[index]
		const other = copy[swap]
		if (current === undefined || other === undefined) continue
		copy[index] = other
		copy[swap] = current
	}
	return copy
}

function takeQuestions(random: () => number, questions: ReadonlyArray<SeedQa>, count: number): Array<SeedQa> {
	return shuffled(random, questions).slice(0, count)
}

function valueTokens(value: unknown): number {
	if (value === undefined) return 0
	return estimateTokens(typeof value === "string" ? value : JSON.stringify(value))
}

function partsTokenCount(parts: ReadonlyArray<MessagePart>): number {
	let total = 0
	for (const part of parts) {
		if (part.type === "text") total += estimateTokens(part.text)
		else if (part.type === "dynamic-tool") {
			total += valueTokens(part.input)
			if (part.state === "output-available") total += valueTokens(part.output)
			else if (part.state === "output-error") total += estimateTokens(part.errorText)
		}
	}
	return total
}

function toolPart(call: SeedToolCall, toolCallId: string): MessagePart {
	const toolMetadata = {
		source: call.source,
		displayName: call.toolName,
		...(call.serverName ? { serverName: call.serverName } : {}),
		outcome: call.outcome ?? "completed",
	}
	if (call.outcome === "interrupted") {
		return {
			type: "dynamic-tool",
			toolName: call.toolName,
			toolCallId,
			input: call.input,
			state: "input-available",
			toolMetadata,
		}
	}
	if (call.outcome === "failed") {
		return {
			type: "dynamic-tool",
			toolName: call.toolName,
			toolCallId,
			input: call.input,
			state: "output-error",
			errorText: call.errorText ?? "Tool execution failed",
			toolMetadata,
		}
	}
	return {
		type: "dynamic-tool",
		toolName: call.toolName,
		toolCallId,
		input: call.input,
		state: "output-available",
		output: call.output,
		toolMetadata,
	}
}

function assistantParts(
	calls: ReadonlyArray<SeedToolCall> | undefined,
	answer: string,
	idPrefix: string,
): Array<MessagePart> {
	const parts: Array<MessagePart> = []
	if (calls && calls.length > 0) {
		parts.push({ type: "step-start" })
		calls.forEach((call, index) => parts.push(toolPart(call, `${idPrefix}-tool-${index}`)))
		parts.push({ type: "step-start" })
	}
	if (answer.length > 0) parts.push({ type: "text", text: answer })
	return parts
}

function turnUsage(input: {
	contextTokens: number
	parts: ReadonlyArray<MessagePart>
	question: string
	tools?: ReadonlyArray<SeedToolCall>
}): { inputTokens: number; outputTokens: number } {
	const toolOverhead = input.tools && input.tools.length > 0 ? TOOL_SCHEMA_TOKENS : 0
	return {
		inputTokens: input.contextTokens + estimateTokens(input.question) + toolOverhead,
		outputTokens: partsTokenCount(input.parts),
	}
}

function planConversation(input: {
	agentId: string
	nextId: (kind: string) => string
	now: Date
	questions: ReadonlyArray<SeedQa>
	random: () => number
	startedAt: Date
}): PlannedRows | undefined {
	const { agentId, nextId, now, questions, random, startedAt } = input
	const conversationId = nextId("conversation")
	const turnCount = 1 + Math.floor(random() * random() * MAX_TURNS_PER_CONVERSATION)
	const pickedQuestions = takeQuestions(random, questions, turnCount)
	const messages: PlannedRows["messages"] = []
	const attempts: PlannedRows["attempts"] = []
	const usages: PlannedRows["usages"] = []
	let contextTokens = SYSTEM_PROMPT_TOKENS
	let latestCompletedMessageId: string | null = null
	let revision = 0
	let cursor = startedAt.getTime()
	for (const question of pickedQuestions) {
		const askedAt = new Date(cursor)
		const answeredAt = new Date(askedAt.getTime() + between(random, ANSWER_DELAY_MIN_MS, ANSWER_DELAY_MAX_MS))
		if (answeredAt.getTime() > now.getTime()) break
		const attemptId = nextId("attempt")
		const parts = assistantParts(question.tools, question.answer, attemptId)
		const { inputTokens, outputTokens } = turnUsage({
			contextTokens,
			parts,
			question: question.question,
			tools: question.tools,
		})
		contextTokens = inputTokens + outputTokens
		const askedMessageId = nextId("message")
		const answeredMessageId = nextId("message")
		messages.push(
			{
				id: askedMessageId,
				conversationId,
				generationAttemptId: attemptId,
				role: "user",
				parts: [{ type: "text", text: question.question }],
				outcome: "completed",
				createdAt: askedAt,
				updatedAt: askedAt,
			},
			{
				id: answeredMessageId,
				conversationId,
				generationAttemptId: attemptId,
				role: "assistant",
				parts,
				outcome: "completed",
				createdAt: answeredAt,
				updatedAt: answeredAt,
			},
		)
		attempts.push({
			id: attemptId,
			conversationId,
			requestId: nextId("request"),
			estimatedInputTokens: estimateTokens(question.question),
			networkHash: "seed-network",
			leaseToken: nextId("lease"),
			leaseExpiresAt: new Date(askedAt.getTime() + MILLISECONDS_PER_MINUTE),
			status: "completed",
			finalOutcome: "completed",
			provider: "seed",
			model: "chat-model",
			providerInvoked: true,
			usageInputTokens: inputTokens,
			usageOutputTokens: outputTokens,
			usageRecordedAt: answeredAt,
			createdAt: askedAt,
			updatedAt: answeredAt,
		})
		usages.push({
			generationAttemptId: attemptId,
			agentId,
			conversationId,
			inputTokens,
			outputTokens,
			outcome: "completed",
			createdAt: answeredAt,
		})
		revision += 1
		latestCompletedMessageId = answeredMessageId
		cursor =
			answeredAt.getTime() + between(random, TURN_GAP_MIN_SECONDS, TURN_GAP_MAX_SECONDS) * MILLISECONDS_PER_SECOND
	}
	if (messages.length === 0) return undefined
	return {
		conversations: [
			{
				id: conversationId,
				agentId,
				embedAccessVersion: 1,
				revision,
				latestCompletedMessageId,
				createdAt: startedAt,
			},
		],
		attempts,
		messages,
		usages,
	}
}

function dayStartUtc(daysAgo: number, now: Date): Date {
	const day = new Date(now)
	day.setUTCHours(0, 0, 0, 0)
	day.setUTCDate(day.getUTCDate() - daysAgo)
	return day
}

function dailyConversationCount(input: {
	basePerDay: number
	dayStart: Date
	daysAgo: number
	random: () => number
}): number {
	const { basePerDay, dayStart, daysAgo, random } = input
	const weekend = dayStart.getUTCDay() === 0 || dayStart.getUTCDay() === SATURDAY_DAY_INDEX
	const growth = GROWTH_FLOOR + ((DAYS - daysAgo) / DAYS) * GROWTH_RANGE
	const noise = NOISE_FLOOR + random() * NOISE_RANGE
	let count = Math.round(basePerDay * (weekend ? WEEKEND_FACTOR : 1) * growth * noise)
	if (random() < QUIET_DAY_CHANCE) count = Math.min(count, 1)
	else if (!weekend && random() < SPIKE_CHANCE) count = Math.round(count * SPIKE_FACTOR)
	return count
}

function pickStartOfDay(random: () => number, dayStart: Date, dayEnd: Date): Date | undefined {
	let target = random() * HOUR_WEIGHT_TOTAL
	let hour = 0
	for (const [index, weight] of HOUR_WEIGHTS.entries()) {
		target -= weight
		if (target < 0) {
			hour = index
			break
		}
	}
	const chosen =
		dayStart.getTime() +
		hour * MILLISECONDS_PER_HOUR +
		Math.floor(random() * MINUTES_PER_HOUR) * MILLISECONDS_PER_MINUTE +
		Math.floor(random() * SECONDS_PER_MINUTE) * MILLISECONDS_PER_SECOND
	return chosen < dayEnd.getTime() ? new Date(chosen) : undefined
}

export function planRows(now: Date): PlannedRows {
	let sequence = 0
	const nextId = (kind: string) => {
		sequence += 1
		return `${MARKER_PREFIX}${sequence}-${kind}`
	}
	const rows: PlannedRows = { attempts: [], conversations: [], messages: [], usages: [] }
	const merge = (planned: PlannedRows | undefined) => {
		if (!planned) return
		rows.conversations.push(...planned.conversations)
		rows.attempts.push(...planned.attempts)
		rows.messages.push(...planned.messages)
		rows.usages.push(...planned.usages)
	}
	for (const [agentIndex, { agentId, basePerDay, questions }] of SEED_AGENTS.entries()) {
		for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
			const dayStart = dayStartUtc(daysAgo, now)
			const dayEnd = daysAgo === 0 ? now : new Date(dayStart.getTime() + MILLISECONDS_PER_DAY)
			const random = dayRandom(agentIndex, daysAgo)
			const count = dailyConversationCount({ basePerDay, dayStart, daysAgo, random })
			for (let index = 0; index < count; index += 1) {
				const startedAt = pickStartOfDay(random, dayStart, dayEnd)
				if (!startedAt) continue
				// Early-morning seeds: skip starts that would run messages into the future.
				merge(planConversation({ agentId, questions, startedAt, now, random, nextId }))
			}
		}
	}
	for (const [agentIndex, { agentId, questions }] of SEED_AGENTS.slice(0, RECENT_CONVERSATION_COUNT).entries()) {
		const random = mulberry32(RECENT_CONVERSATION_SEED + agentIndex)
		const startedAt = new Date(
			now.getTime() - (ACTIVE_MINUTES_AGO + agentIndex * RECENT_CONVERSATION_STAGGER_MINUTES) * MILLISECONDS_PER_MINUTE,
		)
		merge(planConversation({ agentId, questions, startedAt, now, random, nextId }))
	}
	return rows
}

async function seedTraffic(now: Date): Promise<Array<SeededAttempt>> {
	const rows = planRows(now)
	await db.transaction(async (tx) => {
		// Refresh the fixtures on every seed run so the rolling month never goes stale.
		await tx.delete(conversation).where(like(conversation.id, `${MARKER_PREFIX}%`))
		await tx.insert(conversation).values(rows.conversations)
		await tx.insert(generationAttempt).values(rows.attempts)
		await tx.insert(message).values(rows.messages)
	})
	return rows.usages
}

const TRANSCRIPT_AGENT_ID = SEED_AGENTS[0].agentId
const TRANSCRIPT_EMBED_ID = "22222222-2222-4222-8222-222222222222"

type TranscriptTurn = {
	answer: string
	outcome: GenerationAttemptOutcome
	question: string
	tools?: Array<SeedToolCall>
}
type TranscriptConversation = { startedHoursAgo: number; turns: Array<TranscriptTurn> }

const TRANSCRIPTS: Array<TranscriptConversation> = [
	{
		startedHoursAgo: 71.6,
		turns: [
			{
				question: "How long does shipping to Germany take?",
				answer:
					"Orders to Germany usually arrive in **3–5 business days**. You get a tracking link by email once it ships.",
				outcome: "completed",
			},
			{
				question: "Can I change the delivery address after ordering?",
				tools: [
					{
						source: "mcp",
						serverName: "Shop inventory",
						toolName: "list_orders",
						input: { status: "processing" },
						output: { orders: [{ id: "#1042", status: "processing" }] },
					},
				],
				answer:
					"Order **#1042** is still processing. Reply to your confirmation email with the new address and we update it.",
				outcome: "completed",
			},
		],
	},
	{
		startedHoursAgo: 30.4,
		turns: [
			{
				question: "What plans do you offer?",
				answer:
					"We offer three plans:\n\n- **Starter**: one website, email support\n- **Growth**: up to five websites, priority support\n- **Business**: unlimited websites and a dedicated contact\n\nSee the [pricing page](https://example.com/pricing) for current prices.",
				outcome: "completed",
			},
		],
	},
	{
		startedHoursAgo: 26.2,
		turns: [
			{
				question: "How do I add the chat to my website?",
				answer:
					'Paste this snippet before the closing `</body>` tag:\n\n```html\n<script src="https://chat.example.com/widget.js" data-embed-token="YOUR_TOKEN" async></script>\n```\n\n| Platform | Where to paste |\n| --- | --- |\n| Shopify | Theme > Edit code > `theme.liquid` |\n| WordPress | Appearance > Theme file editor > `footer.php` |',
				outcome: "completed",
			},
		],
	},
	{
		startedHoursAgo: 20.1,
		turns: [
			{ question: "Do you integrate with Zendesk?", answer: "We do not integrate directly with", outcome: "blocked" },
		],
	},
	{
		startedHoursAgo: 5.3,
		turns: [{ question: "Is the product available in Czech?", answer: "", outcome: "failed" }],
	},
	{
		startedHoursAgo: 2.1,
		turns: [
			{
				question: "Can I return a sale item?",
				tools: [
					{
						source: "client",
						toolName: "start_return",
						input: { orderId: "#1042", reason: "sale item" },
						outcome: "interrupted",
					},
				],
				answer: "Let me start that return for you.",
				outcome: "interrupted",
			},
		],
	},
	{
		startedHoursAgo: 0.6,
		turns: [
			{
				question: "Write me a long comparison of every plan feature.",
				answer: "Here is a full comparison of every feature, starting with",
				outcome: "cancelled",
			},
		],
	},
	{
		startedHoursAgo: 0.9,
		turns: [
			{
				question: "Can you check if the blue mug is in stock and add one to my cart?",
				tools: [
					{
						source: "mcp",
						serverName: "Shop inventory",
						toolName: "get_stock_level",
						input: { sku: "MUG-BLUE" },
						output: { sku: "MUG-BLUE", available: 42 },
					},
					{
						source: "client",
						toolName: "add_to_cart",
						input: { sku: "MUG-BLUE", quantity: 1 },
						output: { cartCount: 3 },
					},
				],
				answer: "The **blue mug** is in stock with **42 units** left, and I added one to your cart.",
				outcome: "completed",
			},
			{
				question: "Great. Where is my last order?",
				tools: [
					{
						source: "mcp",
						serverName: "Shop inventory",
						toolName: "list_orders",
						input: { limit: 1 },
						output: { orders: [{ id: "#1039", status: "shipped" }] },
					},
				],
				answer: "Your last order **#1039** shipped on Monday and should arrive **tomorrow**.",
				outcome: "completed",
			},
			{
				question: "Can you apply my code SAVE10?",
				tools: [
					{
						source: "client",
						toolName: "apply_discount",
						input: { code: "SAVE10" },
						outcome: "failed",
						errorText: "No active promotion matches this code.",
					},
				],
				answer: "That code is not active right now. The current welcome offer applies automatically at checkout.",
				outcome: "completed",
			},
		],
	},
]

/** Deterministic UUIDv4s, so re-seeding finds the same rows instead of duplicating them. */
function seedId(kind: string, index: number): string {
	return `${kind}-0000-4000-8000-${String(index).padStart(UUID_NODE_DIGITS, "0")}`
}

export function transcriptRows(now: number) {
	let attemptCount = 0
	let messageCount = 0
	const conversations: Array<typeof conversation.$inferInsert> = []
	const attempts: Array<typeof generationAttempt.$inferInsert> = []
	const messages: Array<typeof message.$inferInsert> = []
	const usages: Array<SeededAttempt> = []
	for (const [index, seeded] of TRANSCRIPTS.entries()) {
		const conversationId = seedId("66666666", index)
		const startedAt = now - seeded.startedHoursAgo * MILLISECONDS_PER_HOUR
		let latestCompletedMessageId: string | null = null
		let revision = 0
		let contextTokens = SYSTEM_PROMPT_TOKENS
		for (const [turnIndex, turn] of seeded.turns.entries()) {
			const attemptId = seedId("88888888", (attemptCount += 1))
			const askedAt = new Date(startedAt + turnIndex * MILLISECONDS_PER_MINUTE)
			const answeredAt = new Date(
				askedAt.getTime() + TRANSCRIPT_ANSWER_DELAY_MS + turnIndex * TRANSCRIPT_ANSWER_DELAY_STEP_MS,
			)
			const questionId = seedId("99999999", (messageCount += 1))
			const answerId = seedId("99999999", (messageCount += 1))
			const parts = assistantParts(turn.tools, turn.answer, attemptId)
			const { inputTokens, outputTokens } = turnUsage({
				contextTokens,
				parts,
				question: turn.question,
				tools: turn.tools,
			})
			contextTokens = inputTokens + outputTokens
			if (turn.outcome === "completed") {
				latestCompletedMessageId = answerId
				revision += 1
			}
			attempts.push({
				id: attemptId,
				conversationId,
				requestId: seedId("aaaaaaaa", attemptCount),
				estimatedInputTokens: estimateTokens(turn.question),
				status: turn.outcome,
				finalOutcome: turn.outcome,
				networkHash: "seed-network",
				leaseToken: attemptId,
				leaseExpiresAt: askedAt,
				provider: "openai-compatible",
				model: "chat-model",
				providerInvoked: true,
				usageInputTokens: inputTokens,
				usageOutputTokens: outputTokens,
				usageRecordedAt: answeredAt,
				createdAt: askedAt,
				updatedAt: answeredAt,
			})
			messages.push(
				{
					id: questionId,
					conversationId,
					generationAttemptId: attemptId,
					role: "user",
					parts: [{ type: "text", text: turn.question }],
					outcome: "completed",
					createdAt: askedAt,
					updatedAt: askedAt,
				},
				{
					id: answerId,
					conversationId,
					generationAttemptId: attemptId,
					role: "assistant",
					parts,
					outcome: turn.outcome,
					createdAt: answeredAt,
					updatedAt: answeredAt,
				},
			)
			usages.push({
				generationAttemptId: attemptId,
				agentId: TRANSCRIPT_AGENT_ID,
				conversationId,
				inputTokens,
				outputTokens,
				outcome: turn.outcome,
				createdAt: answeredAt,
			})
		}
		conversations.push({
			id: conversationId,
			referenceId: seedId("77777777", index),
			agentId: TRANSCRIPT_AGENT_ID,
			embedId: TRANSCRIPT_EMBED_ID,
			embedAccessVersion: 1,
			revision,
			latestCompletedMessageId,
			createdAt: new Date(startedAt),
		})
	}
	return { attempts, conversations, messages, usages }
}

async function seedTranscripts(now: number): Promise<Array<SeededAttempt>> {
	const rows = transcriptRows(now)
	await db.transaction(async (tx) => {
		await tx.delete(conversation).where(like(conversation.id, "66666666-%"))
		await tx.insert(conversation).values(rows.conversations)
		await tx.insert(generationAttempt).values(rows.attempts)
		await tx.insert(message).values(rows.messages)
	})
	return rows.usages
}

export async function seed(): Promise<Array<SeededAttempt>> {
	const now = Date.now()
	const transcriptAttempts = await seedTranscripts(now)
	const trafficAttempts = await seedTraffic(new Date(now))
	return [...transcriptAttempts, ...trafficAttempts]
}
