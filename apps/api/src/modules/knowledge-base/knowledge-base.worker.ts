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
	convert(job: T): Promise<string[]>
	embed(text: string): Promise<number[]>
	complete(job: T, chunks: { text: string; embedding: number[] }[]): Promise<void>
	fail(job: T, error: unknown): Promise<void>
}

/* eslint-disable no-await-in-loop -- file and provider work must run strictly one at a time */
export async function processPendingFiles<T extends Job>(dependencies: Dependencies<T>): Promise<void> {
	for (let job = await dependencies.claim(); job; job = await dependencies.claim()) {
		try {
			const texts = await dependencies.convert(job)
			if (!texts.length) throw new IngestionError("empty-document")
			const chunks: { text: string; embedding: number[] }[] = []
			for (const text of texts) chunks.push({ text, embedding: await dependencies.embed(text) })
			await dependencies.complete(job, chunks)
		} catch (error) {
			await dependencies.fail(job, error)
		}
	}
}
/* eslint-enable no-await-in-loop */
