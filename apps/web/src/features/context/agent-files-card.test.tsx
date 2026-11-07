import type { AgentFile } from "@/api/generated/models/agentFile.zod"
import type { QueryClient } from "@/testing/component-harness"
import type { QueryObserverOptions } from "@tanstack/react-query"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

const { AgentFilesCard } = await import("./agent-files-card")
const { LanguageProvider } = await import("@/lib/use-language")
const { t } = await import("i18next")

const FILES_URL = "/api/agents/agent-1/files"
const MAX_SIZE_BYTES = 10_485_760
const SPECIAL_FILE_NAME = "guides/what #1? 50%.md"
const SPECIAL_FILE_URL = `${FILES_URL}/guides%2Fwhat%20%231%3F%2050%25.md`
const FILE: AgentFile = {
	name: "faq.md",
	sizeBytes: 120,
	createdAt: "2026-10-01T10:00:00.000Z",
	embeddingStatus: "failed",
	embeddingError: "conversion-failed",
}

type PendingUpload = ReturnType<typeof Promise.withResolvers<Response>> & { file: File }
type FileOperation = { url: string; method: string; body: unknown }

let files: AgentFile[]
let fileListRequests: number
let fileOperations: FileOperation[]
let fileOperationResponses: Array<Response | Promise<Response>>
let uploads: PendingUpload[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	const method = init?.method ?? "GET"
	if (url === FILES_URL && method === "GET") {
		fileListRequests++
		return json({ files, maxSizeBytes: MAX_SIZE_BYTES, maxNameLength: 255, allowedExtensions: [".md"] })
	}
	if (url === FILES_URL && method === "POST") {
		if (!(init?.body instanceof FormData)) throw new Error("upload body must be FormData")
		const file = init.body.get("file")
		if (!(file instanceof File)) throw new Error("upload body must contain a file")
		const request = Object.assign(Promise.withResolvers<Response>(), { file })
		uploads.push(request)
		return request.promise
	}
	if (url.startsWith(`${FILES_URL}/`)) {
		fileOperations.push({
			url,
			method,
			body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
		})
		if (method === "GET") return new Response("downloaded file")
		const response = fileOperationResponses.shift()
		if (!response) throw new Error(`unexpected request ${method} ${url}`)
		return response
	}
	throw new Error(`unexpected request ${method} ${url}`)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderCard(canManage = false) {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<AgentFilesCard agentId="agent-1" canManage={canManage} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
	await settle()
}

async function selectFiles(selected: File[]): Promise<HTMLInputElement> {
	const input = host.querySelector<HTMLInputElement>("#agent-file-input")
	if (!input) throw new Error("file input not rendered")
	const transfer = new DataTransfer()
	for (const file of selected) transfer.items.add(file)
	input.files = transfer.files
	await act(async () => {
		input.dispatchEvent(new Event("change", { bubbles: true }))
	})
	return input
}

async function resolveUpload(index: number, response: Response) {
	const request = uploads[index]
	if (!request) throw new Error(`upload ${index} not requested`)
	await act(async () => request.resolve(response))
	await settle()
}

function currentRefetchInterval(): number | false | undefined {
	const query = queryClient.getQueryCache().find({ queryKey: [FILES_URL] })
	if (!query) throw new Error("files query not registered")
	// React Query retains observer options here, but QueryOptions omits their type.
	const { refetchInterval } = query.options as QueryObserverOptions
	return typeof refetchInterval === "function" ? refetchInterval(query) : refetchInterval
}

function labelledButton(label: string): HTMLButtonElement | null {
	return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function element<T extends Element>(selector: string): T {
	const found = document.querySelector<T>(selector)
	if (!found) throw new Error(`${selector} not rendered`)
	return found
}

function dialogButton(label: string, role: "dialog" | "alertdialog"): HTMLButtonElement {
	const dialog = element<HTMLElement>(`[role="${role}"]`)
	const found = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) => candidate.textContent?.trim() === label,
	)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

async function click(target: HTMLElement) {
	await act(async () => target.click())
	await settle()
}

async function replaceInputValue(input: HTMLInputElement, value: string) {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(input, value)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

beforeEach(() => {
	files = []
	fileListRequests = 0
	fileOperations = []
	fileOperationResponses = []
	uploads = []
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

describe("AgentFilesCard for a managing operator", () => {
	test("polls only while at least one file is pending or processing", async () => {
		const ready: AgentFile = { ...FILE, name: "ready.md", embeddingStatus: "ready", embeddingError: null }
		files = [ready, { ...FILE, name: "pending.md", embeddingStatus: "pending", embeddingError: null }]
		await renderCard(true)
		expect(currentRefetchInterval()).toBe(3_000)

		files = [ready, { ...FILE, name: "processing.md", embeddingStatus: "processing", embeddingError: null }]
		await act(() => queryClient.refetchQueries({ queryKey: [FILES_URL] }))
		expect(currentRefetchInterval()).toBe(3_000)

		files = [ready, FILE]
		await act(() => queryClient.refetchQueries({ queryKey: [FILES_URL] }))
		expect(currentRefetchInterval()).toBe(false)

		files = [ready, { ...ready, name: "also-ready.md" }]
		await act(() => queryClient.refetchQueries({ queryKey: [FILES_URL] }))
		expect(currentRefetchInterval()).toBe(false)
	})

	test("uploads a max-size file sequentially, stops after failure, and refreshes earlier successes", async () => {
		await renderCard(true)
		const atLimit = new File([new Uint8Array(MAX_SIZE_BYTES)], "one.md")
		const failing = new File(["two"], "two.md")
		const skipped = new File(["three"], "three.md")
		const input = await selectFiles([atLimit, failing, skipped])

		expect(uploads.map(({ file }) => file.name)).toEqual(["one.md"])
		expect(uploads[0]?.file.size).toBe(MAX_SIZE_BYTES)

		const uploaded: AgentFile = {
			name: "one.md",
			sizeBytes: MAX_SIZE_BYTES,
			createdAt: FILE.createdAt,
			embeddingStatus: "ready",
			embeddingError: null,
		}
		files = [uploaded]
		await resolveUpload(0, json({ file: uploaded }, 201))
		expect(uploads.map(({ file }) => file.name)).toEqual(["one.md", "two.md"])

		await resolveUpload(1, json({}, 500))
		expect(uploads.map(({ file }) => file.name)).toEqual(["one.md", "two.md"])
		expect(fileListRequests).toBe(2)
		expect(host.textContent).toContain("one.md")
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("agentFiles.uploadFailed"))
		expect(input.value).toBe("")
		expect(input.files?.length).toBe(0)
	})

	test("rejects a mixed valid and oversize selection without uploading or keeping the selection", async () => {
		await renderCard(true)
		const input = await selectFiles([
			new File(["valid"], "valid.md"),
			new File([new Uint8Array(MAX_SIZE_BYTES + 1)], "large.md"),
		])

		expect(uploads).toHaveLength(0)
		expect(fileListRequests).toBe(1)
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("agentFiles.tooLarge", { maxSizeMB: 10 }))
		expect(input.value).toBe("")
		expect(input.files?.length).toBe(0)
	})

	test("downloads a special file name under its original name and releases the object URL", async () => {
		files = [{ ...FILE, name: SPECIAL_FILE_NAME }]
		const downloaded: { name: string; url: string }[] = []
		const createObjectURL = spyOn(URL, "createObjectURL").mockReturnValue("blob:agent-file")
		const revokeObjectURL = spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
		spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
			downloaded.push({ name: this.download, url: this.href })
		})
		await renderCard(true)
		const download = element<HTMLButtonElement>(
			`button[aria-label="${t("agentFiles.download", { name: SPECIAL_FILE_NAME })}"]`,
		)

		await click(download)

		expect(fileOperations).toEqual([{ url: SPECIAL_FILE_URL, method: "GET", body: undefined }])
		expect(downloaded).toEqual([{ name: SPECIAL_FILE_NAME, url: "blob:agent-file" }])
		const blob = createObjectURL.mock.calls[0]?.[0]
		if (!(blob instanceof Blob)) throw new Error("download did not create a blob URL")
		expect(await blob.text()).toBe("downloaded file")
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:agent-file")
		expect(download.disabled).toBe(false)
	})

	test("keeps a failed rename open, then refreshes after retrying the trimmed name", async () => {
		const original = { ...FILE, name: SPECIAL_FILE_NAME }
		const renamed = { ...FILE, name: "renamed.md" }
		files = [original]
		fileOperationResponses = [json({}, 500), json({ file: renamed })]
		await renderCard(true)
		await click(
			element<HTMLButtonElement>(`button[aria-label="${t("agentFiles.rename", { name: SPECIAL_FILE_NAME })}"]`),
		)
		const input = element<HTMLInputElement>("#rename-file-name")
		expect(input.value).toBe("guides/what #1? 50%")
		await replaceInputValue(input, "  renamed  ")

		await click(dialogButton(t("agentFiles.renameSave"), "dialog"))

		expect(element<HTMLElement>('[role="dialog"] [role="alert"]').textContent).toBe(t("agentFiles.renameFailed"))
		expect(input.value).toBe("  renamed  ")
		expect(fileListRequests).toBe(1)
		const request: FileOperation = { url: SPECIAL_FILE_URL, method: "PATCH", body: { name: "renamed" } }
		expect(fileOperations).toEqual([request])

		files = [renamed]
		await click(dialogButton(t("agentFiles.renameSave"), "dialog"))

		expect(document.querySelector('[role="dialog"]') === null).toBe(true)
		expect(fileOperations).toEqual([request, request])
		expect(fileListRequests).toBe(2)
		expect(host.textContent).toContain("renamed.md")
		expect(host.textContent).not.toContain(SPECIAL_FILE_NAME)
	})

	test("keeps a failed deletion open, then refreshes after confirmation succeeds", async () => {
		files = [{ ...FILE, name: SPECIAL_FILE_NAME }]
		fileOperationResponses = [json({}, 500), new Response(null, { status: 204 })]
		await renderCard(true)
		await click(
			element<HTMLButtonElement>(`button[aria-label="${t("agentFiles.delete", { name: SPECIAL_FILE_NAME })}"]`),
		)
		expect(element<HTMLElement>('[role="alertdialog"]').textContent).toContain(SPECIAL_FILE_NAME)

		await click(dialogButton(t("agentFiles.deleteConfirm"), "alertdialog"))

		expect(element<HTMLElement>('[role="alertdialog"] [role="alert"]').textContent).toBe(t("agentFiles.deleteFailed"))
		expect(fileListRequests).toBe(1)
		const request: FileOperation = { url: SPECIAL_FILE_URL, method: "DELETE", body: undefined }
		expect(fileOperations).toEqual([request])

		files = []
		await click(dialogButton(t("agentFiles.deleteConfirm"), "alertdialog"))

		expect(document.querySelector('[role="alertdialog"]') === null).toBe(true)
		expect(fileOperations).toEqual([request, request])
		expect(fileListRequests).toBe(2)
		expect(host.textContent).not.toContain(SPECIAL_FILE_NAME)
	})

	test("retains an actionable retry failure, then refreshes after an encoded retry succeeds", async () => {
		files = [{ ...FILE, name: SPECIAL_FILE_NAME }]
		fileOperationResponses = [
			json({ code: "internal-server-error", type: "https://docs.talqo.chat/problems#internal-server-error" }, 500),
			new Response(null, { status: 204 }),
		]
		await renderCard(true)
		const retryLabel = t("agentFiles.retry", { name: SPECIAL_FILE_NAME })
		const request: FileOperation = { url: `${SPECIAL_FILE_URL}/retry`, method: "POST", body: undefined }

		await click(element<HTMLButtonElement>(`button[aria-label="${retryLabel}"]`))

		expect(element<HTMLElement>('[role="alert"]').textContent).toBe(t("problems.internal-server-error"))
		expect(fileOperations).toEqual([request])
		expect(fileListRequests).toBe(1)
		const retry = labelledButton(retryLabel)
		if (!retry) throw new Error("retry button not rendered")
		expect(retry.disabled).toBe(false)

		const pendingRetry = Promise.withResolvers<Response>()
		fileOperationResponses[1] = pendingRetry.promise
		files = [{ ...FILE, name: SPECIAL_FILE_NAME, embeddingStatus: "pending", embeddingError: null }]
		await click(retry)
		expect(retry.disabled).toBe(true)
		expect(host.querySelector('[role="alert"]') === null).toBe(true)
		await act(async () => pendingRetry.resolve(new Response(null, { status: 204 })))
		await settle()
		await settle()

		expect(host.querySelector('[role="alert"]') === null).toBe(true)
		expect(fileOperations).toEqual([request, request])
		expect(fileListRequests).toBe(2)
		expect(host.textContent).toContain(t("agentFiles.status.pending"))
		expect(labelledButton(retryLabel) === null).toBe(true)
	})
})
