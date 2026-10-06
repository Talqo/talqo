export const MCP_ARGUMENT_LIMIT = 50
const ARGUMENT_MAX_LENGTH = 200

export type AddArgumentResult =
	| { ok: true; argument: string; args: string[] }
	| { ok: false; reason: "duplicate" | "empty" | "limit" | "tooLong" }

export function addArgument(args: string[], input: string): AddArgumentResult {
	const argument = input.trim()
	if (argument.length === 0) return { ok: false, reason: "empty" }
	if (argument.length > ARGUMENT_MAX_LENGTH) return { ok: false, reason: "tooLong" }
	if (args.includes(argument)) return { ok: false, reason: "duplicate" }
	if (args.length >= MCP_ARGUMENT_LIMIT) return { ok: false, reason: "limit" }
	return { ok: true, argument, args: [...args, argument] }
}

export function removeArgument(args: string[], argument: string): string[] {
	return args.filter((existing) => existing !== argument)
}
