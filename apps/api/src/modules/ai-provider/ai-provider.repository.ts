import { db } from "@/db/client.ts"
import { and, eq } from "drizzle-orm"

import type { StoredConfiguration } from "./ai-provider.types.ts"

import { aiProviderConfig } from "./ai-provider.schema.ts"

const CONFIG_ID = "singleton"

function toStored(row: typeof aiProviderConfig.$inferSelect): StoredConfiguration {
	return { id: row.id, revision: row.revision, text: row.text, embedding: row.embedding }
}

export async function find(): Promise<StoredConfiguration | undefined> {
	const [row] = await db.select().from(aiProviderConfig).where(eq(aiProviderConfig.id, CONFIG_ID))
	return row ? toStored(row) : undefined
}

export async function save(
	configuration: Omit<StoredConfiguration, "revision">,
	expectedRevision: number,
): Promise<StoredConfiguration | undefined> {
	const revision = expectedRevision + 1
	if (expectedRevision === 0) {
		const [row] = await db
			.insert(aiProviderConfig)
			.values({ ...configuration, revision })
			.onConflictDoNothing()
			.returning()
		return row ? toStored(row) : undefined
	}

	const [row] = await db
		.update(aiProviderConfig)
		.set({ text: configuration.text, embedding: configuration.embedding, revision, updatedAt: new Date() })
		.where(and(eq(aiProviderConfig.id, CONFIG_ID), eq(aiProviderConfig.revision, expectedRevision)))
		.returning()
	return row ? toStored(row) : undefined
}

export async function reset(): Promise<void> {
	await db.delete(aiProviderConfig)
}
