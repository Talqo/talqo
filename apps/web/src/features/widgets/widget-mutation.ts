import { useMutation, useQueryClient } from "@tanstack/react-query"

import type { Widget, WidgetInput } from "./widget-client.ts"

import { createWidget, deleteWidget, updateWidget } from "./widget-client.ts"
import { widgetQueryKeys } from "./widgets-query.ts"

export function useCreateWidget() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async (input: WidgetInput & { agentId: string; name: string }) => (await createWidget(input)).widget,
		onSuccess: (widget: Widget) => {
			queryClient.setQueryData(widgetQueryKeys.detail(widget.id), widget)
			return queryClient.invalidateQueries({ queryKey: widgetQueryKeys.list() })
		},
	})
}

/**
 * No optimistic update: the live preview already renders from form state, so
 * optimism would buy nothing visible while risking a divergent view on failure.
 */
export function useUpdateWidget(id: string) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async (input: WidgetInput) => (await updateWidget(id, input)).widget,
		onSuccess: (widget: Widget) => {
			queryClient.setQueryData(widgetQueryKeys.detail(id), widget)
			return queryClient.invalidateQueries({ queryKey: widgetQueryKeys.list() })
		},
	})
}

export function useDeleteWidget() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => deleteWidget(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: widgetQueryKeys.all }),
	})
}
