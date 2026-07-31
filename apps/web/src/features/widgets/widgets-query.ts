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

// Mock data until the /widgets API endpoint exists.
// Kept in a mutable module-level store so edits made on the bot config page
// stay visible on the other dashboard pages.
let widgets: Widget[] = [
	{
		id: "bot-1",
		name: "Support Bot",
		status: "active",
		systemPrompt: "You are a helpful customer support assistant for a SaaS product.",
		wordBlacklist: ["spam", "abuse"],
	},
	{
		id: "bot-2",
		name: "Sales Assistant",
		status: "active",
		systemPrompt: "You are a friendly sales assistant that helps visitors choose the right plan.",
		wordBlacklist: ["scam"],
	},
	{
		id: "bot-3",
		name: "FAQ Bot",
		status: "paused",
		systemPrompt: "You answer frequently asked questions from the knowledge base.",
		wordBlacklist: [],
	},
]

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
