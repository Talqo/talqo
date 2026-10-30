import type { QueryClient } from "@tanstack/react-query"

// Lists and aggregates can combine agents, so loss of access evicts all protected agent content.
export function clearAgentContent(client: QueryClient): void {
	client.removeQueries({
		predicate: ({ queryKey }) => {
			const path = queryKey[0]
			if (typeof path !== "string") return false
			return (
				path.startsWith("/api/agents/") ||
				["/api/embeds", "/api/conversations", "/api/stats"].some(
					(prefix) => path === prefix || path.startsWith(`${prefix}/`),
				)
			)
		},
	})
}
