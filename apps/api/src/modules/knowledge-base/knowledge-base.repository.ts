import { sql } from "@/db/client.ts"

export type SourceKind = "file" | "website"
export type FileStatus = "pending" | "processing" | "ready" | "failed"
export type FileFailureReason = "conversion-failed" | "empty-document" | "provider-error" | "unknown"
export type WebsiteFailureReason = "website-blocked" | "website-unreachable" | "website-too-large"
export type FailureReason = FileFailureReason | WebsiteFailureReason
export type Job = { id: string; agentId: string; name: string; kind: SourceKind; generation: number }
export type StoredWebsite = {
	id: string
	agentId: string
	name: string
	createdAt: Date
	status: FileStatus
	error: FailureReason | null
}
type StoredWebsiteRow = Omit<StoredWebsite, "createdAt"> & { createdAt: string }

function storedWebsite({ createdAt, ...website }: StoredWebsiteRow): StoredWebsite {
	return { ...website, createdAt: new Date(createdAt) }
}

export async function enqueue(agentId: string, name: string): Promise<void> {
	await sql`INSERT INTO agent_file (id, agent_id, name, status) VALUES (${crypto.randomUUID()}, ${agentId}, ${name}, 'pending')
		ON CONFLICT (agent_id, name) DO NOTHING`
}

export async function statuses(
	agentId: string,
): Promise<Map<string, { status: FileStatus; error: FileFailureReason | null }>> {
	const rows = await sql<{ name: string; status: FileStatus; error: FileFailureReason | null }[]>`
		SELECT name, status, error FROM agent_file WHERE agent_id = ${agentId} AND kind = 'file'`
	return new Map(rows.map(({ name, status, error }) => [name, { status, error }]))
}

export async function listAll(): Promise<{ agentId: string; name: string }[]> {
	const rows = await sql<{ agentId: string; name: string }[]>`
		SELECT agent_id AS "agentId", name FROM agent_file WHERE kind = 'file'`
	return rows
}

export async function insertWebsite(agentId: string, name: string): Promise<StoredWebsite> {
	const [website] = await sql<StoredWebsiteRow[]>`
		INSERT INTO agent_file (id, agent_id, name, kind, status)
		VALUES (${crypto.randomUUID()}, ${agentId}, ${name}, 'website', 'pending')
		RETURNING id, agent_id AS "agentId", name, created_at AS "createdAt", status, error`
	if (!website) throw new Error("Website insert returned no row")
	return storedWebsite(website)
}

export async function listWebsites(agentId: string): Promise<StoredWebsite[]> {
	const rows = await sql<StoredWebsiteRow[]>`
		SELECT id, agent_id AS "agentId", name, created_at AS "createdAt", status, error
		FROM agent_file WHERE agent_id = ${agentId} AND kind = 'website' ORDER BY created_at, id`
	return rows.map(storedWebsite)
}

export async function findWebsite(agentId: string, id: string): Promise<StoredWebsite | undefined> {
	const rows = await sql<StoredWebsiteRow[]>`
		SELECT id, agent_id AS "agentId", name, created_at AS "createdAt", status, error
		FROM agent_file WHERE agent_id = ${agentId} AND id = ${id} AND kind = 'website'`
	const website = rows[0]
	return website ? storedWebsite(website) : undefined
}

export async function refreshWebsite(agentId: string, id: string): Promise<boolean> {
	const rows = await sql`UPDATE agent_file SET status = 'pending', error = NULL, generation = generation + 1
		WHERE agent_id = ${agentId} AND id = ${id} AND kind = 'website' AND status IN ('ready', 'failed') RETURNING id`
	return rows.length > 0
}

export async function removeWebsite(agentId: string, id: string): Promise<boolean> {
	const rows = await sql`DELETE FROM agent_file WHERE agent_id = ${agentId} AND id = ${id} AND kind = 'website' RETURNING id`
	return rows.length > 0
}

export async function retry(agentId: string, name: string): Promise<boolean> {
	const rows = await sql`UPDATE agent_file SET status = 'pending', error = NULL, generation = generation + 1
		WHERE agent_id = ${agentId} AND name = ${name} AND kind = 'file' AND status = 'failed' RETURNING id`
	return rows.length > 0
}

export async function rename(agentId: string, oldName: string, newName: string): Promise<void> {
	if (oldName === newName) return
	await sql`UPDATE agent_file SET name = ${newName}, generation = generation + 1,
		status = CASE WHEN status = 'processing' THEN 'pending' ELSE status END
		WHERE agent_id = ${agentId} AND name = ${oldName} AND kind = 'file'`
}

export async function remove(agentId: string, name: string): Promise<void> {
	await sql`DELETE FROM agent_file WHERE agent_id = ${agentId} AND name = ${name} AND kind = 'file'`
}

export async function claim(modelKey: string): Promise<Job | undefined> {
	const rows = await sql<
		Job[]
	>`UPDATE agent_file SET status = 'processing', model_key = ${modelKey}, generation = generation + 1
		WHERE id = (SELECT id FROM agent_file WHERE status = 'pending' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING id, agent_id AS "agentId", name, kind, generation`
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
		if (chunks.length) {
			await tx`INSERT INTO agent_file_chunk (file_id, position, text, embedding)
				SELECT t.file_id, t.position, t.text, t.embedding::vector FROM unnest(
					${chunks.map(() => job.id)}::text[],
					${chunks.map((_, position) => position)}::int[],
					${chunks.map((chunk) => chunk.text)}::text[],
					${chunks.map((chunk) => JSON.stringify(chunk.embedding))}::text[]
				) AS t(file_id, position, text, embedding)`
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

export async function hasReadyFiles(agentId: string): Promise<boolean> {
	const [row] = await sql<{ ready: boolean }[]>`
		SELECT EXISTS (SELECT 1 FROM agent_file WHERE agent_id = ${agentId} AND status = 'ready') AS ready`
	return row?.ready === true
}

export async function search(agentId: string, embedding: number[], modelKey: string, limit: number): Promise<string[]> {
	const rows = await sql<{ text: string }[]>`
		SELECT c.text FROM agent_file_chunk c
		JOIN agent_file f ON f.id = c.file_id
		WHERE f.agent_id = ${agentId} AND f.status = 'ready' AND f.model_key = ${modelKey}
		ORDER BY c.embedding <=> ${JSON.stringify(embedding)}::vector LIMIT ${limit}`
	return rows.map((row) => row.text)
}
