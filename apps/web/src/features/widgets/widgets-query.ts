import { useQuery, useQueryClient } from "@tanstack/react-query"

import type { Widget } from "./widget-client.ts"

import { getWidget, listWidgets } from "./widget-client.ts"

export type { Widget }

export const widgetQueryKeys = {
	all: ["widgets"] as const,
	list: () => [...widgetQueryKeys.all, "list"] as const,
	detail: (id: string) => [...widgetQueryKeys.all, "detail", id] as const,
}

export function useWidgets() {
	return useQuery({
		queryKey: widgetQueryKeys.list(),
		queryFn: async ({ signal }) => (await listWidgets(signal)).widgets,
	})
}

export function useWidget(id: string) {
	const queryClient = useQueryClient()
	return useQuery({
		queryKey: widgetQueryKeys.detail(id),
		queryFn: async ({ signal }) => (await getWidget(id, signal)).widget,
		// Paint from the list the operator just came from, then refetch in the background.
		initialData: () => queryClient.getQueryData<Widget[]>(widgetQueryKeys.list())?.find((widget) => widget.id === id),
		initialDataUpdatedAt: () => queryClient.getQueryState(widgetQueryKeys.list())?.dataUpdatedAt,
	})
}
