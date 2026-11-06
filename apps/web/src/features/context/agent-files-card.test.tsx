import type { AgentFile } from "@/api/generated/models/agentFile.zod"
import type { QueryClient } from "@/testing/component-harness"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { AgentFilesCard } = await import("./agent-files-card")
const { LanguageProvider } = await import("@/lib/use-language")
const { t } = await import("i18next")

const FILE: AgentFile = {
	name: "faq.md",
	sizeBytes: 120,
	createdAt: "2026-10-01T10:00:00.000Z",
	embeddingStatus: "failed",
	embeddingError: "conversion-failed",
}

let files: AgentFile[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>

async function respond(input: RequestInfo | URL): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	if (url === "/api/agents/agent-1/files") {
		return json({ files, maxSizeBytes: 10_485_760, maxNameLength: 255, allowedExtensions: [".md"] })
	}
	throw new Error(`unexpected request ${url}`)
}

async function renderCard() {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<AgentFilesCard agentId="agent-1" canManage={false} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function labelledButton(label: string): HTMLButtonElement | null {
	return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

beforeEach(() => {
	files = []
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("AgentFilesCard for a read-only operator", () => {
	test("lists files with download only", async () => {
		files = [FILE]
		await renderCard()

		expect(host.textContent).toContain("faq.md")
		expect(labelledButton(t("agentFiles.download", { name: "faq.md" }))).not.toBeNull()
		expect(labelledButton(t("agentFiles.rename", { name: "faq.md" })) === null).toBe(true)
		expect(labelledButton(t("agentFiles.delete", { name: "faq.md" })) === null).toBe(true)
		expect(labelledButton(t("agentFiles.retry", { name: "faq.md" })) === null).toBe(true)
		expect(host.textContent).not.toContain(t("agentFiles.dropzone"))
	})

	test("says there are no files yet instead of showing an empty card", async () => {
		await renderCard()

		expect(host.textContent).toContain(t("agentFiles.emptyTitle"))
		expect(host.textContent).toContain(t("agentFiles.emptyDescriptionReader"))
	})
})
