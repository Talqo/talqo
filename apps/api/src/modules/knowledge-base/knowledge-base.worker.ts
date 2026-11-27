import type { FailureReason } from "./knowledge-base.repository.ts"

type Job = { id: string; name: string }

export class IngestionError extends Error {
	constructor(
		readonly reason: FailureReason,
		options?: ErrorOptions,
	) {
		super(reason, options)
	}
}

type Dependencies<T extends Job> = {
	claim(): Promise<T | undefined>
	convert(job: T): Promise<Array<string>>
	embed(text: string): Promise<Array<number>>
	/** False means the embedding model changed mid-job, so the batch must stop instead of re-converting. */
	complete(job: T, chunks: Array<{ text: string; embedding: Array<number> }>): Promise<boolean>
	fail(job: T, error: unknown): Promise<void>
}

export async function processPendingFiles<T extends Job>(dependencies: Dependencies<T>): Promise<void> {
	// File and provider work runs strictly one job at a time.
	for (let job = await dependencies.claim(); job; job = await dependencies.claim()) {
		try {
			const texts = await dependencies.convert(job)
			if (!texts.length) throw new IngestionError("empty-document")
			const chunks: Array<{ text: string; embedding: Array<number> }> = []
			for (const text of texts) chunks.push({ text, embedding: await dependencies.embed(text) })
			if (!(await dependencies.complete(job, chunks))) return
		} catch (error) {
			await dependencies.fail(job, error)
		}
	}
}
