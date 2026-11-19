import { describe, expect, it } from "bun:test"

import { IngestionError, processPendingSources } from "./knowledge-base.worker.ts"

describe("knowledge ingestion", () => {
	it("reports a document with no chunks as a file failure", async () => {
		let claimed = false
		let failure: unknown
		await processPendingSources({
			claim: async () => {
				if (claimed) return undefined
				claimed = true
				return { id: "empty", name: "empty.md" }
			},
			convert: async () => [],
			embed: async () => {
				throw new Error("Embedding should not run")
			},
			complete: async () => {
				throw new Error("Completion should not run")
			},
			fail: async (_job, error) => {
				failure = error
			},
		})
		expect(failure).toBeInstanceOf(IngestionError)
		expect((failure as IngestionError).reason).toBe("empty-document")
	})
	it("processes mixed files and websites in order, then continues after a failure", async () => {
		const events: string[] = []
		const jobs = [
			{ id: "first", name: "https://example.test", kind: "website" },
			{ id: "second", name: "second.txt", kind: "file" },
		]
		await processPendingSources({
			claim: async () => jobs.shift(),
			convert: async (job) => {
				events.push(`convert:${job.id}`)
				return job.id === "first" ? ["one", "two"] : ["three"]
			},
			embed: async (text) => {
				events.push(`embed:${text}`)
				if (text === "two") throw new Error("provider rejected input")
				return [1, 2]
			},
			complete: async (job, chunks) => {
				events.push(`complete:${job.id}:${chunks.length}`)
			},
			fail: async (job) => {
				events.push(`fail:${job.id}`)
			},
		})
		expect(events).toEqual([
			"convert:first",
			"embed:one",
			"embed:two",
			"fail:first",
			"convert:second",
			"embed:three",
			"complete:second:1",
		])
	})
})
