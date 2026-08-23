import { useEffect, useRef, useState } from "react"

import type { DiscoveryContext } from "./discovery-readiness.ts"

import { useDiscoverAiProviderModels } from "./ai-configuration-query.ts"
import { hasCompleteCredentials, isDiscoveryReady, requiredCredentials } from "./discovery-readiness.ts"

const DISCOVERY_DEBOUNCE_MS = 400

export type ModelDiscoveryState = {
	models: string[] | null
	loading: boolean
	failed: boolean
	retry: () => void
}

export function useModelDiscovery(
	context: DiscoveryContext & { storedCredentialRole: "text" | "embedding" },
): ModelDiscoveryState {
	const discover = useDiscoverAiProviderModels()
	const [models, setModels] = useState<string[] | null>(null)
	const [loading, setLoading] = useState(false)
	const [failed, setFailed] = useState(false)
	const [retryTick, setRetryTick] = useState(0)
	const requestRef = useRef(0)

	const { provider } = context
	const ready = isDiscoveryReady(context)
	const signature = ready
		? JSON.stringify([
				provider.id,
				context.value.authMode,
				provider.settingFields.map((field) => context.value.settings[field]?.trim() ?? ""),
				requiredCredentials(provider, context.value.credentials),
				retryTick,
			])
		: null

	useEffect(() => {
		if (!signature) {
			setModels(null)
			setLoading(false)
			setFailed(false)
			return
		}
		const requestId = ++requestRef.current
		setLoading(true)
		setFailed(false)
		const handle = setTimeout(() => {
			const complete = hasCompleteCredentials(provider, context.value.credentials)
			const { settings } = context.value
			const data = complete
				? {
						providerId: provider.id,
						authMode: "static" as const,
						settings,
						credentials: requiredCredentials(provider, context.value.credentials),
					}
				: {
						providerId: provider.id,
						authMode: "static" as const,
						settings,
						storedCredentialRole: context.storedCredentialRole,
					}
			discover
				.mutateAsync({ data })
				.then((result) => {
					if (requestRef.current !== requestId) return
					setModels(result.data.models)
					setLoading(false)
				})
				.catch(() => {
					if (requestRef.current !== requestId) return
					setModels(null)
					setLoading(false)
					setFailed(true)
				})
		}, DISCOVERY_DEBOUNCE_MS)
		return () => clearTimeout(handle)
	}, [signature])

	return { models, loading, failed, retry: () => setRetryTick((tick) => tick + 1) }
}
