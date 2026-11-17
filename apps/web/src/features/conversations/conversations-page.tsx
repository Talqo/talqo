import { useListConversations } from "@/api/generated/conversation/conversation.ts"
import { PageHeader } from "@/components/page-header"
import { AgentFilter } from "@/features/statistics/components/agent-filter"
import { useLanguage } from "@/lib/use-language"
import { keepPreviousData } from "@tanstack/react-query"
import { useRef } from "react"
import { useTranslation } from "react-i18next"

import type { ConversationsSearch } from "./conversations-search"

import { ConversationResults } from "./conversations-results"
import { useConversationFilters } from "./use-conversation-filters"

type Props = {
	search: ConversationsSearch
	onSearchChange: (search: ConversationsSearch) => void
}

export function ConversationsPage({ search, onSearchChange }: Props) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const resultsHeading = useRef<HTMLHeadingElement>(null)
	const page = search.page ?? 1
	const { agentLines, agentNames, awaitingAgents, effectiveAgents, filterChanged, noAgentSelected, selectedIds } =
		useConversationFilters(search, onSearchChange)

	const conversationsQuery = useListConversations(
		{ agentId: effectiveAgents, page: filterChanged ? 1 : page },
		{ query: { enabled: !noAgentSelected && !awaitingAgents, placeholderData: keepPreviousData } },
	)
	const result = conversationsQuery.data?.data

	function goToPage(next: number) {
		onSearchChange({ ...search, page: next > 1 ? next : undefined })
		resultsHeading.current?.focus()
	}

	return (
		<div className="space-y-6">
			<PageHeader title={t("conversations.listHeading")} description={t("conversations.listDescription")} />

			<div className="flex flex-wrap items-center gap-4">
				{agentLines.length > 0 && (
					<AgentFilter
						agentLines={agentLines}
						selectedIds={selectedIds}
						onChange={(ids) =>
							onSearchChange({
								...search,
								agents: ids.length === agentLines.length ? undefined : ids,
								page: undefined,
							})
						}
					/>
				)}
			</div>

			{!noAgentSelected && conversationsQuery.isPending ? (
				<output className="sr-only">{t("conversations.loading")}</output>
			) : null}

			<section className="space-y-4" aria-busy={conversationsQuery.isFetching}>
				<h2
					ref={resultsHeading}
					tabIndex={-1}
					className="focus-visible:ring-ring/50 rounded-sm text-sm font-medium outline-none focus-visible:ring-3"
				>
					{result ? t("conversations.total", { count: result.total }) : t("conversations.listHeading")}
				</h2>

				<ConversationResults
					agentNames={agentNames}
					error={conversationsQuery.error}
					filtered={effectiveAgents !== undefined}
					isPending={conversationsQuery.isPending}
					language={language}
					noAgentSelected={noAgentSelected}
					onFirstPage={() => goToPage(1)}
					onPageChange={goToPage}
					onRetry={() => void conversationsQuery.refetch()}
					page={page}
					result={result}
					search={search}
				/>
			</section>
		</div>
	)
}
