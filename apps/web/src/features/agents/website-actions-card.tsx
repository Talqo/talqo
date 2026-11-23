import type { Agent } from "@/api/generated/models/agent.zod.ts"

import { getGetAgentQueryKey, useUpdateAgent } from "@/api/generated/agent/agent.ts"
import { getProblemMessage } from "@/lib/problem-message"
import { useDirtyFormGuard } from "@/lib/use-dirty-form-guard"
import { zodResolver } from "@hookform/resolvers/zod"
import { APPROVAL_INSTRUCTIONS_MAX_LENGTH } from "@talqo/shared/page-control"
import { Button } from "@talqo/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@talqo/ui/components/card"
import { FormActions } from "@talqo/ui/components/form-actions"
import { Label } from "@talqo/ui/components/label"
import { Switch } from "@talqo/ui/components/switch"
import { Textarea } from "@talqo/ui/components/textarea"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import {
	Controller,
	type FieldError,
	useForm,
	type UseFormRegister,
	type UseFormSetValue,
	useWatch,
} from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"

const schema = z.object({
	enabled: z.boolean(),
	approvalInstructions: z.string().trim().min(1).max(APPROVAL_INSTRUCTIONS_MAX_LENGTH),
})
type Values = z.infer<typeof schema>

function ErrorAlert({ message }: { message: string }) {
	return (
		<p role="alert" className="text-destructive text-sm">
			{message}
		</p>
	)
}

function ApprovalInstructions({
	canManage,
	pending,
	error,
	register,
}: {
	canManage: boolean
	pending: boolean
	error: FieldError | undefined
	register: UseFormRegister<Values>
}) {
	const { t } = useTranslation()
	return (
		<div className="space-y-2">
			<Label htmlFor="website-approval">{t("pageControl.instructions")}</Label>
			<Textarea
				id="website-approval"
				rows={5}
				readOnly={!canManage || pending}
				maxLength={APPROVAL_INSTRUCTIONS_MAX_LENGTH}
				aria-invalid={!!error}
				aria-describedby={error ? "website-approval-error" : undefined}
				{...register("approvalInstructions")}
			/>
			{error && (
				<p id="website-approval-error" role="alert" className="text-destructive text-xs">
					{t("pageControl.instructionsRequired", { max: APPROVAL_INSTRUCTIONS_MAX_LENGTH })}
				</p>
			)}
		</div>
	)
}

function Actions({
	defaultInstructions,
	saved,
	showReset,
	pending,
	dirty,
	instructions,
	setValue,
}: {
	defaultInstructions: string
	saved: boolean
	showReset: boolean
	pending: boolean
	dirty: boolean
	instructions: string
	setValue: UseFormSetValue<Values>
}) {
	const { t } = useTranslation()
	return (
		<FormActions status={saved ? t("agentConfig.saved") : undefined}>
			{showReset && (
				<Button
					type="button"
					variant="outline"
					disabled={pending || instructions === defaultInstructions}
					onClick={() =>
						setValue("approvalInstructions", defaultInstructions, {
							shouldDirty: true,
							shouldValidate: true,
						})
					}
				>
					{t("pageControl.restoreDefaults")}
				</Button>
			)}
			<Button type="submit" disabled={pending || !dirty}>
				{pending ? t("agentConfig.saving") : t("agentConfig.save")}
			</Button>
		</FormActions>
	)
}

export function WebsiteActionsCard({ agent, canManage }: { agent: Agent; canManage: boolean }) {
	const { t } = useTranslation()
	const client = useQueryClient()
	const update = useUpdateAgent()
	const [error, setError] = useState<string>()
	const [saved, setSaved] = useState(false)
	const { enabled, approvalInstructions, defaultApprovalInstructions } = agent.pageControl
	const { control, register, handleSubmit, reset, setValue, setFocus, formState } = useForm<Values>({
		resolver: zodResolver(schema),
		defaultValues: { enabled, approvalInstructions },
	})
	useEffect(() => {
		reset({ enabled, approvalInstructions })
	}, [enabled, approvalInstructions, reset])
	const isEnabled = useWatch({ control, name: "enabled" })
	const instructions = useWatch({ control, name: "approvalInstructions" })
	const guard = useDirtyFormGuard(formState.isDirty)
	const showInstructions = isEnabled || !!formState.errors.approvalInstructions

	async function save(values: Values): Promise<void> {
		if (!canManage) return
		setError(undefined)
		setSaved(false)
		try {
			const result = await update.mutateAsync({
				agentId: agent.id,
				data: {
					name: agent.name,
					systemPrompt: agent.systemPrompt,
					wordBlacklist: agent.wordBlacklist,
					pageControl: values,
				},
			})
			const savedPageControl = result.data.agent.pageControl
			reset({ enabled: savedPageControl.enabled, approvalInstructions: savedPageControl.approvalInstructions })
			client.setQueryData(getGetAgentQueryKey(agent.id), result)
			setSaved(true)
		} catch (caught) {
			setError(getProblemMessage(caught, t, t("agents.saveFailed")))
		}
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-4">
					<CardTitle level={2} id="website-actions-title">
						{t("pageControl.title")}
					</CardTitle>
					<Controller
						control={control}
						name="enabled"
						render={({ field }) => (
							<Switch
								aria-labelledby="website-actions-title"
								aria-describedby="website-actions-description"
								checked={field.value}
								onCheckedChange={field.onChange}
								disabled={!canManage || update.isPending}
							/>
						)}
					/>
				</div>
				<CardDescription id="website-actions-description">{t("pageControl.description")}</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit(save, () => setFocus("approvalInstructions"))} className="space-y-4">
					{error && <ErrorAlert message={error} />}
					{showInstructions && (
						<ApprovalInstructions
							canManage={canManage}
							pending={update.isPending}
							error={formState.errors.approvalInstructions}
							register={register}
						/>
					)}
					{canManage && (
						<Actions
							defaultInstructions={defaultApprovalInstructions}
							saved={saved && !formState.isDirty}
							showReset={showInstructions}
							pending={update.isPending}
							dirty={formState.isDirty}
							instructions={instructions}
							setValue={setValue}
						/>
					)}
				</form>
				{guard}
			</CardContent>
		</Card>
	)
}
