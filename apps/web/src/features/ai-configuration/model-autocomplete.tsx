import { Autocomplete } from "@base-ui/react/autocomplete"
import { Combobox } from "@base-ui/react/combobox"
import { Input } from "@talqo/ui/components/input"
import { CheckIcon, ChevronsUpDownIcon, LoaderCircleIcon } from "lucide-react"

type ModelAutocompleteProps = {
	id: string
	value: string
	onChange: (value: string) => void
	models: string[] | null
	loading?: boolean
	disabled?: boolean
	placeholder?: string
	emptyLabel: string
	triggerLabel: string
}

function FieldInput({
	id,
	placeholder,
	loading,
	triggerLabel,
}: {
	id: string
	placeholder?: string
	loading: boolean
	triggerLabel: string
}) {
	return (
		<>
			<Autocomplete.Input id={id} placeholder={placeholder} render={<Input className="pr-8" />} />
			<Autocomplete.Trigger
				aria-label={triggerLabel}
				className="text-muted-foreground hover:text-foreground size-control-sm rounded-item absolute top-1/2 right-1 inline-flex -translate-y-1/2 items-center justify-center outline-none"
			>
				{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ChevronsUpDownIcon className="size-4" />}
			</Autocomplete.Trigger>
		</>
	)
}

export function ModelAutocomplete({
	id,
	value,
	onChange,
	models,
	loading = false,
	disabled = false,
	placeholder,
	emptyLabel,
	triggerLabel,
}: ModelAutocompleteProps) {
	if (models === null) {
		return (
			<div className="relative">
				<Input
					id={id}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					disabled={disabled}
					autoComplete="off"
					spellCheck={false}
				/>
				{loading && (
					<LoaderCircleIcon className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin" />
				)}
			</div>
		)
	}

	return (
		<Autocomplete.Root items={models} value={value} onValueChange={(next) => onChange(next)} disabled={disabled}>
			<div className="relative">
				<FieldInput id={id} placeholder={placeholder} loading={loading} triggerLabel={triggerLabel} />
			</div>
			<Combobox.Portal>
				<Combobox.Positioner sideOffset={4} className="isolate z-50">
					<Combobox.Popup className="bg-popover text-popover-foreground ring-foreground/10 rounded-overlay relative max-h-72 w-(--anchor-width) min-w-36 overflow-x-hidden overflow-y-auto p-1 shadow-md ring-1">
						<Combobox.Empty className="text-muted-foreground px-3 py-2 text-xs">{emptyLabel}</Combobox.Empty>
						<Combobox.List>
							{(model: string) => (
								<Combobox.Item
									key={model}
									value={model}
									className="data-highlighted:bg-accent data-highlighted:text-accent-foreground min-h-item rounded-item relative flex w-full cursor-default items-center gap-2 pr-8 pl-3 text-sm outline-none select-none"
								>
									{model}
									<Combobox.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
										<CheckIcon className="size-4" />
									</Combobox.ItemIndicator>
								</Combobox.Item>
							)}
						</Combobox.List>
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Autocomplete.Root>
	)
}
