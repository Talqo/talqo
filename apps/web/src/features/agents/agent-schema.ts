import { z } from "zod"

export const agentFormSchema = z.object({
	name: z.string().min(1),
	systemPrompt: z.string().min(1),
	wordBlacklist: z.string(),
	active: z.boolean(),
})

export type AgentFormValues = z.infer<typeof agentFormSchema>
