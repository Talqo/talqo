import type { FormEvent, RefObject } from "react"

import SendIcon from "@/assets/icons/send.svg?react"
import StopIcon from "@/assets/icons/stop.svg?react"
import { useTranslation } from "react-i18next"

const composerButtonClasses =
	"tw:flex tw:size-control tw:shrink-0 tw:items-center tw:justify-center tw:rounded-control tw:bg-primary tw:text-primary-foreground tw:transition-colors tw:hover:bg-primary/90 tw:disabled:opacity-50"

type ChatComposerProps = {
	draft: string
	inputRef: RefObject<HTMLInputElement | null>
	monitoringNoticeId: string
	sendAvailable: boolean
	disabled: boolean
	showStop: boolean
	stopping: boolean
	onDraftChange: (value: string) => void
	onCancel: () => void
	onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function ChatComposer({
	draft,
	inputRef,
	monitoringNoticeId,
	sendAvailable,
	disabled,
	showStop,
	stopping,
	onDraftChange,
	onCancel,
	onSubmit,
}: ChatComposerProps) {
	const { t } = useTranslation()

	return (
		<form onSubmit={onSubmit} className="tw:flex tw:items-center tw:gap-2 tw:border-border tw:border-t tw:p-4">
			<input
				ref={inputRef}
				type="text"
				value={draft}
				onChange={(event) => onDraftChange(event.target.value)}
				placeholder={t("placeholder")}
				aria-label={t("messageLabel")}
				aria-describedby={monitoringNoticeId}
				disabled={disabled}
				className="tw:h-control tw:min-w-0 tw:flex-1 tw:rounded-control tw:border tw:border-input-border tw:bg-input tw:px-control-padding tw:text-sm tw:outline-none tw:placeholder:text-muted-foreground tw:focus-visible:border-ring tw:focus-visible:ring-2 tw:focus-visible:ring-ring/50 tw:disabled:opacity-50"
			/>
			{showStop ? (
				<button
					type="button"
					onClick={onCancel}
					aria-label={stopping ? t("stopping") : t("stopGenerating")}
					disabled={stopping}
					className={composerButtonClasses}
				>
					<StopIcon aria-hidden="true" />
				</button>
			) : (
				<button
					type="submit"
					aria-label={t("send")}
					disabled={!sendAvailable || draft.trim().length === 0}
					className={composerButtonClasses}
				>
					<SendIcon aria-hidden="true" />
				</button>
			)}
		</form>
	)
}
