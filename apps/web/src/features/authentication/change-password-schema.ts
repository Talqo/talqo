import { ChangePasswordBody } from "@/api/generated/models/identity/changePasswordBody.zod.ts"
import { CompleteForcedPasswordChangeBody } from "@/api/generated/models/identity/completeForcedPasswordChangeBody.zod.ts"
import { ResetUserPasswordBody } from "@/api/generated/models/roles/resetUserPasswordBody.zod.ts"
import { z } from "zod"

const passwordConfirmationIssue = { message: "passwordMismatch", path: ["confirmPassword"] }
const passwordsMatch = (values: { confirmPassword: string; newPassword: string }) =>
	values.confirmPassword === values.newPassword

export const changePasswordSchema = ChangePasswordBody.safeExtend({ confirmPassword: z.string() }).refine(
	passwordsMatch,
	passwordConfirmationIssue,
)

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>

export const forcedPasswordChangeSchema = CompleteForcedPasswordChangeBody.safeExtend({
	confirmPassword: z.string(),
}).refine(passwordsMatch, passwordConfirmationIssue)

export type ForcedPasswordChangeFormValues = z.infer<typeof forcedPasswordChangeSchema>

export const resetPasswordSchema = ResetUserPasswordBody.safeExtend({ confirmPassword: z.string() }).refine(
	passwordsMatch,
	passwordConfirmationIssue,
)

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>
