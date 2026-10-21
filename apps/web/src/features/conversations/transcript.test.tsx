import { describe, expect, test } from "bun:test"

await import("@/lib/i18n")

const { Transcript } = await import("./transcript")
const { renderToStaticMarkup } = await import("react-dom/server")
const { t } = await import("i18next")

const CREATED_AT = "2026-10-01T10:00:00.000Z"

describe("Transcript", () => {
	test("renders agent Markdown without executing model HTML and labels unfinished answers", () => {
		const html = renderToStaticMarkup(
			<Transcript
				messages={[
					{ id: "1", role: "user", text: "**not bold**", outcome: "completed", createdAt: CREATED_AT },
					{
						id: "2",
						role: "assistant",
						text: "**Yes** <img src=x onerror=alert(1)>",
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
	test("labels every unfinished answer and drops empty bubbles", () => {
		const outcomes = ["streaming", "failed", "cancelled", "interrupted"] as const
		const html = renderToStaticMarkup(
			<Transcript
				messages={outcomes.map((outcome, index) => ({
					id: `${index}`,
					role: "assistant" as const,
					text: "",
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
})
