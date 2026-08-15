import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from "@talqo/shared"
import { z } from "zod"

const credentialsFormFieldsSchema = z.object({
	username: z.string().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH).regex(USERNAME_PATTERN),
	password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
	confirmPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

export const credentialsFormSchema = credentialsFormFieldsSchema
	.pick({
		password: true,
		username: true,
	})
	.extend({ confirmPassword: z.string().optional() })

export const registrationFormSchema = credentialsFormFieldsSchema.refine(
	(values) => values.confirmPassword === values.password,
	{
		message: "passwordMismatch",
		path: ["confirmPassword"],
	},
)

export type CredentialsFormValues = z.infer<typeof credentialsFormSchema>
export type RegistrationFormValues = z.infer<typeof registrationFormSchema>
