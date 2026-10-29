import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { Button } from "@talqo/ui/components/button"
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@talqo/ui/components/dialog"
import { Input } from "@talqo/ui/components/input"
import { Label } from "@talqo/ui/components/label"
import { type ReactNode, useId, useState } from "react"

type TypeToConfirm = {
	value: string
	label: string
	placeholder?: string
}

type ConfirmDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: ReactNode
	description?: ReactNode
	children?: ReactNode
	confirmLabel: string
	pendingLabel?: string
	cancelLabel: string
	onConfirm: () => void
	pending?: boolean
	error?: ReactNode
	typeToConfirm?: TypeToConfirm
}

type ConfirmDialogBodyProps = Omit<ConfirmDialogProps, "open" | "onOpenChange"> & {
	onCancel: () => void
}

function ConfirmDialogBody({
	title,
	description,
	children,
	confirmLabel,
	pendingLabel,
	cancelLabel,
	onConfirm,
	pending = false,
	error,
	typeToConfirm,
	onCancel,
}: ConfirmDialogBodyProps) {
	const [confirmation, setConfirmation] = useState("")
	const inputId = useId()
	const confirmDisabled = pending || (typeToConfirm !== undefined && confirmation !== typeToConfirm.value)

	return (
		<>
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
				{description ? <DialogDescription>{description}</DialogDescription> : null}
			</DialogHeader>
			{children}
			{error ? (
				<div role="alert" className="text-destructive text-sm">
					{error}
				</div>
			) : null}
			{typeToConfirm ? (
				<div className="space-y-2">
					<Label htmlFor={inputId}>{typeToConfirm.label}</Label>
					<Input
						id={inputId}
						value={confirmation}
						onChange={(event) => setConfirmation(event.target.value)}
						placeholder={typeToConfirm.placeholder}
						autoComplete="off"
					/>
				</div>
			) : null}
			<DialogFooter>
				<Button variant="outline" disabled={pending} onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button variant="destructive" disabled={confirmDisabled} onClick={onConfirm}>
					{pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
				</Button>
			</DialogFooter>
		</>
	)
}

function ConfirmDialog({ open, onOpenChange, pending = false, ...props }: ConfirmDialogProps) {
	function handleOpenChange(next: boolean) {
		if (!next && pending) return
		onOpenChange(next)
	}

	return (
		<AlertDialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
			<DialogContent showCloseButton={false}>
				<ConfirmDialogBody {...props} pending={pending} onCancel={() => handleOpenChange(false)} />
			</DialogContent>
		</AlertDialogPrimitive.Root>
	)
}

export { ConfirmDialog }
