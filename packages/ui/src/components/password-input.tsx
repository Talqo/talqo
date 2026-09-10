"use client"

import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { cn } from "@talqo/ui/lib/utils"
import { Eye, EyeOff } from "lucide-react"
import { useState, type ComponentProps } from "react"

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
	hideLabel: string
	showLabel: string
}

function PasswordInput({ className, hideLabel, showLabel, ...props }: PasswordInputProps) {
	const [visible, setVisible] = useState(false)

	return (
		<div className="relative">
			<Input type={visible ? "text" : "password"} className={cn("pr-11", className)} {...props} />
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute inset-y-0 right-1 my-auto"
				onClick={() => setVisible((current) => !current)}
				aria-label={visible ? hideLabel : showLabel}
				tabIndex={-1}
			>
				{visible ? <EyeOff /> : <Eye />}
			</Button>
		</div>
	)
}

export { PasswordInput }
