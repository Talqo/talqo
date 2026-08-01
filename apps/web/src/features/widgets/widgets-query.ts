import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"

export type Widget = {
	id: string
	name: string
	status: "active" | "paused"
	systemPrompt: string
	wordBlacklist: string[]
}

const widgetsQueryKey = ["widgets"] as const

// Interim in-memory stand-in until the /widgets API endpoint exists; the API
// stays authoritative, so the dashboard ships with an honest empty state.
// Demo entries load only when explicitly requested for local development
// (VITE_MOCK_WIDGETS=true), never silently. Created and edited bots live in
// this module store so the config page stays consistent within the session.
const DEMO_WIDGETS: Widget[] = [
	{
		id: "demo-1",
		name: "Demo bot 1",
		status: "active",
		systemPrompt: "Demo system prompt.",
		wordBlacklist: ["spam", "abuse"],
	},
	{
		id: "demo-2",
		name: "Demo bot 2",
		status: "paused",
		systemPrompt: "Demo system prompt.",
		wordBlacklist: [],
	},
]

let widgets: Widget[] = import.meta.env.VITE_MOCK_WIDGETS === "true" ? [...DEMO_WIDGETS] : []

export function useWidgets() {
	return useQuery({
		queryKey: widgetsQueryKey,
		queryFn: () => Promise.resolve(widgets),
		staleTime: Number.POSITIVE_INFINITY,
	})
}

// The selected bot lives in the `bot` search param (validated on the routes
// that use this hook), so selection survives navigation and is shareable.
export function useActiveWidget() {
	const { data: widgetList, isLoading } = useWidgets()
	const { bot: selectedId } = useSearch({ strict: false })
	const navigate = useNavigate()
	const activeId =
		typeof selectedId === "string" && widgetList?.some((widget) => widget.id === selectedId)
			? selectedId
			: (widgetList?.[0]?.id ?? "")
	const setSelectedId = (id: string) =>
		navigate({
			to: ".",
			search: (previous: Record<string, unknown>) => ({ ...previous, bot: id || undefined }),
			replace: true,
		})
	return { widgets: widgetList, isLoading, activeId, setSelectedId }
}

// Returns null for unknown ids (e.g. a stale /dashboard/bot/$botId link) so the
// page can render its not-found state; React Query rejects undefined data.
export function useWidget(id: string) {
	return useQuery({
		queryKey: [...widgetsQueryKey, id],
		queryFn: () => Promise.resolve(widgets.find((widget) => widget.id === id) ?? null),
	})
}

function useInvalidateWidgets() {
	const queryClient = useQueryClient()
	return () => queryClient.invalidateQueries({ queryKey: widgetsQueryKey })
}

export function useUpdateWidget() {
	const invalidate = useInvalidateWidgets()
	return (id: string, patch: Partial<Omit<Widget, "id">>) => {
		widgets = widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget))
		invalidate()
	}
}

export function useCreateWidget() {
	const invalidate = useInvalidateWidgets()
	return (input: Omit<Widget, "id">) => {
		const widget: Widget = { id: `local-${Date.now()}`, ...input }
		widgets = [...widgets, widget]
		invalidate()
		return widget
	}
}
