import { z } from "zod"

const AGENT_NAME_MAX_LENGTH = 100
const SYSTEM_PROMPT_MAX_LENGTH = 20_000

export const agentFormSchema = z.object({
	name: z.string().trim().min(1).max(AGENT_NAME_MAX_LENGTH),
	systemPrompt: z.string().trim().min(1).max(SYSTEM_PROMPT_MAX_LENGTH),
})

export type AgentFormValues = z.infer<typeof agentFormSchema>
