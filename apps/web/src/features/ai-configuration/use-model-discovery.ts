import {
	discoverAiProviderModels,
	type DiscoverAiProviderModelsMutationBody,
} from "@/api/generated/ai-providers/ai-providers.ts"
import { useEffect, useState } from "react"

import type { DiscoveryContext } from "./discovery-readiness.ts"

import { hasCompleteCredentials, isDiscoveryReady, requiredCredentials } from "./discovery-readiness.ts"

const DISCOVERY_DEBOUNCE_MS = 400

export type ModelDiscoveryState = {
	models: string[] | null
	loading: boolean
	failed: boolean
	retry: () => void
}

type DiscoveryResult = {
	request: DiscoverAiProviderModelsMutationBody
	attempt: number
	models: string[] | null
	failed: boolean
}

type DiscoveryContextWithRole = DiscoveryContext & { storedCredentialRole: "text" | "embedding" }

function discoveryRequest(context: DiscoveryContextWithRole): DiscoverAiProviderModelsMutationBody | null {
	if (!isDiscoveryReady(context)) return null
	const { provider, value, storedCredentialRole } = context
	const { settings, credentials } = value
	const connection = { providerId: provider.id, authMode: "static" as const, settings }
	if (hasCompleteCredentials(provider, credentials)) {
		return { ...connection, credentials: requiredCredentials(provider, credentials) }
	}
	return { ...connection, storedCredentialRole }
}

export function useModelDiscovery(context: DiscoveryContextWithRole): ModelDiscoveryState {
	const [result, setResult] = useState<DiscoveryResult | null>(null)
	const [attempt, setAttempt] = useState(0)
	const nextRequest = discoveryRequest(context)
	const signature = JSON.stringify(nextRequest)
	const [active, setActive] = useState({ signature, request: nextRequest })
	// Form controllers clone records on model edits; only connection changes restart discovery.
	if (active.signature !== signature) setActive({ signature, request: nextRequest })
	const { request } = active

	useEffect(() => {
		if (!request) return undefined
		const controller = new AbortController()
		const handle = setTimeout(() => {
			void discoverAiProviderModels(request, { signal: controller.signal }).then(
				(response) => {
					if (!controller.signal.aborted) setResult({ request, attempt, models: response.data.models, failed: false })
				},
				() => {
					if (!controller.signal.aborted) setResult({ request, attempt, models: null, failed: true })
				},
			)
		}, DISCOVERY_DEBOUNCE_MS)
		return () => {
			clearTimeout(handle)
			controller.abort()
		}
	}, [request, attempt])

	const current = result?.request === request && result?.attempt === attempt ? result : null
	return {
		models: current?.models ?? null,
		loading: request !== null && current === null,
		failed: current?.failed ?? false,
		retry: () => setAttempt((previous) => previous + 1),
	}
}
