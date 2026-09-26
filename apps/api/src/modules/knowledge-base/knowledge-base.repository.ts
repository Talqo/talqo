import { sql } from "@/db/client.ts"

export type FileStatus = "pending" | "processing" | "ready" | "failed"
export type FailureReason = "conversion-failed" | "empty-document" | "provider-error" | "unknown"
export type Job = { id: string; agentId: string; name: string; generation: number }

export async function enqueue(agentId: string, name: string): Promise<void> {
	await sql`INSERT INTO agent_file (id, agent_id, name, status) VALUES (${crypto.randomUUID()}, ${agentId}, ${name}, 'pending')
		ON CONFLICT (agent_id, name) DO NOTHING`
}

export async function statuses(
	agentId: string,
): Promise<Map<string, { status: FileStatus; error: FailureReason | null }>> {
	const rows = await sql<{ name: string; status: FileStatus; error: FailureReason | null }[]>`
		SELECT name, status, error FROM agent_file WHERE agent_id = ${agentId}`
	return new Map(rows.map(({ name, status, error }) => [name, { status, error }]))
}

export async function retry(agentId: string, name: string): Promise<boolean> {
	const rows = await sql`UPDATE agent_file SET status = 'pending', error = NULL, generation = generation + 1
		WHERE agent_id = ${agentId} AND name = ${name} AND status = 'failed' RETURNING id`
	return rows.length > 0
}

export async function rename(agentId: string, oldName: string, newName: string): Promise<void> {
	if (oldName === newName) return
	await sql`UPDATE agent_file SET name = ${newName}, generation = generation + 1,
		status = CASE WHEN status = 'processing' THEN 'pending' ELSE status END
		WHERE agent_id = ${agentId} AND name = ${oldName}`
}

export async function remove(agentId: string, name: string): Promise<void> {
	await sql`DELETE FROM agent_file WHERE agent_id = ${agentId} AND name = ${name}`
}

export async function claim(modelKey: string): Promise<Job | undefined> {
	const rows = await sql<
		Job[]
	>`UPDATE agent_file SET status = 'processing', model_key = ${modelKey}, generation = generation + 1
		WHERE id = (SELECT id FROM agent_file WHERE status = 'pending' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING id, agent_id AS "agentId", name, generation`
	return rows[0]
}

export async function recover(): Promise<void> {
	await sql`UPDATE agent_file SET status = 'pending', generation = generation + 1 WHERE status = 'processing'`
}

export async function reindexChanged(modelKey: string): Promise<void> {
	await sql`UPDATE agent_file SET status = 'pending', error = NULL, generation = generation + 1
		WHERE model_key IS DISTINCT FROM ${modelKey} AND status IN ('ready', 'failed')`
}

export async function complete(
	job: Job,
	modelKey: string,
	chunks: { text: string; embedding: number[] }[],
): Promise<void> {
	await sql.begin(async (tx) => {
		const rows = await tx`SELECT id FROM agent_file WHERE id = ${job.id} AND generation = ${job.generation}
			AND status = 'processing' FOR UPDATE`
		if (!rows.length) return
		await tx`DELETE FROM agent_file_chunk WHERE file_id = ${job.id}`
		for (const [position, chunk] of chunks.entries()) {
			// eslint-disable-next-line no-await-in-loop -- one transaction writes chunks in order without a burst of queries
			await tx`INSERT INTO agent_file_chunk (file_id, position, text, embedding)
				VALUES (${job.id}, ${position}, ${chunk.text}, ${JSON.stringify(chunk.embedding)}::vector)`
		}
		await tx`UPDATE agent_file SET status = 'ready', error = NULL, model_key = ${modelKey} WHERE id = ${job.id}`
	})
}

export async function fail(job: Job, error: FailureReason): Promise<void> {
	await sql`UPDATE agent_file SET status = 'failed', error = ${error}
		WHERE id = ${job.id} AND generation = ${job.generation} AND status = 'processing'`
}

export async function requeue(job: Job): Promise<void> {
	await sql`UPDATE agent_file SET status = 'pending' WHERE id = ${job.id}
		AND generation = ${job.generation} AND status = 'processing'`
}
