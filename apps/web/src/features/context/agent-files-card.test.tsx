import type { AgentFile } from "@/api/generated/models/agentFile.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

// Component test files share one process, so only the first one registers the DOM.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { AgentFilesCard } = await import("./agent-files-card")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
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

async function respond(input: RequestInfo | URL): Promise<Response> {
	const url = String(input)
	if (url === "/api/agents/agent-1/files") {
		return new Response(
			JSON.stringify({ files, maxSizeBytes: 10_485_760, maxNameLength: 255, allowedExtensions: [".md"] }),
			{
				status: 200,
				headers: { "content-type": "application/json" },
			},
		)
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
	spyOn(globalThis, "fetch").mockImplementation(respond as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	queryClient.clear()
	mock.restore()
})

describe("AgentFilesCard for a read-only operator", () => {
	test("lists files with download only", async () => {
		files = [FILE]
		await renderCard()

		expect(host.textContent).toContain("faq.md")
		expect(labelledButton(t("agentFiles.download", { name: "faq.md" }))).not.toBeNull()
		expect(labelledButton(t("agentFiles.rename", { name: "faq.md" }))).toBeNull()
		expect(labelledButton(t("agentFiles.delete", { name: "faq.md" }))).toBeNull()
		expect(labelledButton(t("agentFiles.retry", { name: "faq.md" }))).toBeNull()
		expect(host.textContent).not.toContain(t("agentFiles.dropzone"))
	})

	test("says there are no files yet instead of showing an empty card", async () => {
		await renderCard()

		expect(host.textContent).toContain(t("agentFiles.empty"))
	})
})
