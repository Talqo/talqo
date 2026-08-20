import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@talqo/shared"
import { z } from "zod"

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

function withConfirmPasswordRefine<
	Schema extends z.ZodObject<{ confirmPassword: z.ZodString; newPassword: z.ZodTypeAny }>,
>(schema: Schema) {
	return schema.refine((values) => values.confirmPassword === values.newPassword, {
		message: "passwordMismatch",
		path: ["confirmPassword"],
	})
}

export const changePasswordSchema = withConfirmPasswordRefine(
	z.object({
		currentPassword: z.string().min(1),
		newPassword: passwordSchema,
		confirmPassword: z.string(),
	}),
)

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>

export const resetPasswordSchema = withConfirmPasswordRefine(
	z.object({
		newPassword: passwordSchema,
		confirmPassword: z.string(),
	}),
)

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>
