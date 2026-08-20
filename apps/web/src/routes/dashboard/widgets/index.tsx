import { useListAgents } from "@/api/generated/agent/agent.ts"
import { PageHeader } from "@/components/page-header"
import { WIDGET_FORM_DEFAULTS } from "@/features/widgets/widget-appearance-form"
import { useCreateWidget } from "@/features/widgets/widget-mutation"
import { useWidgets } from "@/features/widgets/widgets-query"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@talqo/ui/components/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@talqo/ui/components/dialog"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Plus, Settings2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/widgets/")({
	component: WidgetsPage,
})

function WidgetsPage() {
	const { t } = useTranslation()
	const { data: widgets, isLoading, isError } = useWidgets()
	const { data: agentsResponse } = useListAgents()
	const agents = agentsResponse?.data.agents
	const createWidget = useCreateWidget()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [name, setName] = useState("")
	const [agentId, setAgentId] = useState("")

	const agentName = (id: string) => agents?.find((agent) => agent.id === id)?.name ?? t("widgetSetup.unknownAgent")

	async function onCreate() {
		if (!name.trim() || !agentId) {
			return
		}
		try {
			await createWidget.mutateAsync({ name: name.trim(), agentId, appearance: WIDGET_FORM_DEFAULTS })
		} catch {
			// Reported below from createWidget.isError; keep the draft so it can be retried.
			return
		}
		setName("")
		setAgentId("")
		setDialogOpen(false)
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<PageHeader
				title={t("widgetSetup.heading")}
				description={t("widgetSetup.subheading")}
				actions={
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger render={<Button />} disabled={!agents?.length}>
							<Plus className="size-4" />
							{t("widgetSetup.createWidget")}
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{t("widgetSetup.createWidget")}</DialogTitle>
								<DialogDescription>{t("widgetSetup.createDescription")}</DialogDescription>
							</DialogHeader>
							<div className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="widget-name">{t("widgetSetup.nameLabel")}</Label>
									<Input
										id="widget-name"
										placeholder={t("widgetSetup.namePlaceholder")}
										value={name}
										onChange={(event) => setName(event.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="widget-agent">{t("widgetSetup.agentLabel")}</Label>
									<Select value={agentId} onValueChange={(value) => setAgentId(value ?? "")}>
										<SelectTrigger id="widget-agent" className="w-full">
											<SelectValue placeholder={t("widgetSetup.selectAgent")} />
										</SelectTrigger>
										<SelectContent>
											{agents?.map((agent) => (
												<SelectItem key={agent.id} value={agent.id}>
													{agent.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								{createWidget.isError && (
									<p role="alert" className="text-destructive text-sm">
										{t("widgetSetup.createError")}
									</p>
								)}
							</div>
							<DialogFooter>
								<Button onClick={onCreate} disabled={createWidget.isPending || !name.trim() || !agentId}>
									{createWidget.isPending ? t("widgetSetup.creating") : t("widgetSetup.createWidget")}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				}
			/>

			{isLoading ? (
				<p className="text-muted-foreground">{t("widgetSetup.loading")}</p>
			) : isError ? (
				<p role="alert" className="text-destructive">
					{t("widgetSetup.loadError")}
				</p>
			) : !agents?.length ? (
				<p className="text-muted-foreground">{t("widgetSetup.empty")}</p>
			) : !widgets?.length ? (
				<p className="text-muted-foreground">{t("widgetSetup.noWidgets")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{widgets.map((widget) => (
						<Card key={widget.id}>
							<CardHeader>
								<CardTitle>{widget.name}</CardTitle>
							</CardHeader>
							<CardContent className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<span
										aria-hidden="true"
										className="size-4 rounded-full border"
										style={{ backgroundColor: widget.appearance.primary }}
									/>
									<span className="text-muted-foreground text-sm">
										{t("widgetSetup.servedBy", { name: agentName(widget.agentId) })}
									</span>
								</div>
								<Button
									render={<Link to="/dashboard/widgets/$widgetId" params={{ widgetId: widget.id }} />}
									nativeButton={false}
									variant="outline"
									size="sm"
								>
									<Settings2 className="size-4" />
									{t("widgetSetup.customize")}
								</Button>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	)
}
