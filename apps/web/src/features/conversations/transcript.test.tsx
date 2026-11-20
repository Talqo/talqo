import type { ConversationMessage as Message } from "@/api/generated/models/conversationMessage.zod.ts"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")

const { Transcript } = await import("./transcript")
const { renderToStaticMarkup } = await import("react-dom/server")
const { t } = await import("i18next")

const CREATED_AT = "2026-10-01T10:00:00.000Z"

function toolPart(id: string): Message["parts"][number] {
	return {
		type: "dynamic-tool",
		toolName: "lookup",
		toolCallId: id,
		input: {},
		toolMetadata: { source: "mcp", displayName: "lookup", outcome: "completed" },
		state: "output-available",
		output: {},
	}
}

describe("Transcript", () => {
	test("renders agent Markdown without executing model HTML and labels unfinished answers", () => {
		const html = renderToStaticMarkup(
			<Transcript
				messages={[
					{
						id: "1",
						role: "user",
						text: "**not bold**",
						parts: [{ type: "text", text: "**not bold**" }],
						outcome: "completed",
						createdAt: CREATED_AT,
					},
					{
						id: "2",
						role: "assistant",
						text: "**Yes** <img src=x onerror=alert(1)>",
						parts: [{ type: "text", text: "**Yes** <img src=x onerror=alert(1)>" }],
						outcome: "blocked",
						createdAt: CREATED_AT,
					},
				]}
			/>,
		)

		expect(html).toContain("**not bold**")
		expect(html).toContain("<strong>Yes</strong>")
		expect(html).not.toContain("<img")
		expect(html).toContain(t("conversations.outcomeBlocked"))
	})
})

describe("Transcript outcomes", () => {
	test("labels visitors and agents without an outcome for completed messages", () => {
		const html = renderToStaticMarkup(
			<Transcript
				messages={[
					{
						id: "1",
						role: "user",
						text: "Hello",
						parts: [{ type: "text", text: "Hello" }],
						outcome: "completed",
						createdAt: CREATED_AT,
					},
					{
						id: "2",
						role: "assistant",
						text: "Hi",
						parts: [{ type: "text", text: "Hi" }],
						outcome: "completed",
						createdAt: CREATED_AT,
					},
				]}
			/>,
		)

		expect(html).toContain(t("conversations.visitor"))
		expect(html).toContain(t("conversations.agent"))
		expect(html).not.toContain(t("conversations.outcomeFailed"))
		expect(html).not.toContain(t("conversations.outcomeStreaming"))
	})

	test("labels every unfinished answer and drops empty bubbles", () => {
		const outcomes = ["streaming", "failed", "cancelled", "interrupted"] as const
		const html = renderToStaticMarkup(
			<Transcript
				messages={outcomes.map((outcome, index) => ({
					id: `${index}`,
					role: "assistant" as const,
					text: "",
					parts: [],
					outcome,
					createdAt: CREATED_AT,
				}))}
			/>,
		)

		expect(html).toContain(t("conversations.outcomeStreaming"))
		expect(html).toContain(t("conversations.outcomeFailed"))
		expect(html).toContain(t("conversations.outcomeCancelled"))
		expect(html).toContain(t("conversations.outcomeInterrupted"))
		expect(html).not.toContain('data-slot="markdown"')
	})

	test("does not label an outcome on a visitor message", () => {
		const html = renderToStaticMarkup(
			<Transcript
				messages={[
					{
						id: "1",
						role: "user",
						text: "Hello",
						parts: [{ type: "text", text: "Hello" }],
						outcome: "failed",
						createdAt: CREATED_AT,
					},
				]}
			/>,
		)

		expect(html).toContain(t("conversations.visitor"))
		expect(html).not.toContain(t("conversations.outcomeFailed"))
	})

	test("groups consecutive tool calls into one collapsed block and keeps single calls bare", () => {
		const html = renderToStaticMarkup(
			<Transcript
				messages={[
					{
						id: "1",
						role: "assistant",
						text: "",
						parts: [toolPart("first"), { type: "text", text: "Answer" }, toolPart("second"), toolPart("third")],
						outcome: "completed",
						createdAt: CREATED_AT,
					},
				]}
			/>,
		)

		expect(html.match(/<details/g) ?? []).toHaveLength(1)
		expect(html).not.toContain("<details open")
		expect(html).toContain(t("conversations.toolsCalled", { count: 2 }))
		expect(html.match(/<output/g) ?? []).toHaveLength(3)
	})
})
