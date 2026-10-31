import type { CreateAgentMutationError } from "@/api/generated/agent/agent.ts"

import { useCreateAgent } from "@/api/generated/agent/agent.ts"
import { nextDefaultName } from "@/lib/default-name"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const FORBIDDEN_STATUS = 403
const CONFLICT_STATUS = 409

type CreateFailure = { message: string; retryable: boolean }

function failureMessage(status: number | undefined, t: (key: string) => string): string {
	if (status === FORBIDDEN_STATUS) return t("agents.manageForbidden")
	if (status === CONFLICT_STATUS) return t("agents.nameConflict")
	return t("agents.createFailed")
}

/** Creates an agent with the shared defaults, then hands the new id to the caller. */
export function useCreateAgentFlow({
	names,
	refreshNames,
	onCreated,
}: {
	names: string[]
	refreshNames: () => Promise<unknown>
	onCreated: (agentId: string) => unknown
}) {
	const { t } = useTranslation()
	const createAgent = useCreateAgent()
	const [failure, setFailure] = useState<CreateFailure | null>(null)

	async function create() {
		setFailure(null)
		try {
			const created = await createAgent.mutateAsync({
				data: {
					name: nextDefaultName(names, t("agents.defaultName")),
					systemPrompt: t("agents.defaultSystemPrompt"),
					wordBlacklist: [],
				},
			})
			await onCreated(created.data.agent.id)
		} catch (caught) {
			const status = (caught as CreateAgentMutationError).status
			// A conflict means the loaded names are stale; refresh them so the next attempt picks a free one.
			if (status === CONFLICT_STATUS) await refreshNames()
			setFailure({ message: failureMessage(status, t), retryable: status !== FORBIDDEN_STATUS })
		}
	}

	return { create, pending: createAgent.isPending, failure }
}
