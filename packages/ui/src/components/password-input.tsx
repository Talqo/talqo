"use client"

import { Button } from "@talqo/ui/components/button"
import { Input } from "@talqo/ui/components/input"
import { cn } from "@talqo/ui/lib/utils"
import { Eye, EyeOff } from "lucide-react"
import * as React from "react"

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
	hideLabel: string
	showLabel: string
}

function PasswordInput({ className, hideLabel, showLabel, ...props }: PasswordInputProps) {
	const [visible, setVisible] = React.useState(false)

	return (
		<div className="relative">
			<Input type={visible ? "text" : "password"} className={cn("pr-8", className)} {...props} />
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute inset-y-0 right-0.5 my-auto"
				onClick={() => setVisible((current) => !current)}
				aria-label={visible ? hideLabel : showLabel}
			>
				{visible ? <EyeOff /> : <Eye />}
			</Button>
		</div>
	)
}

export { PasswordInput }
