import { useQuery } from "@tanstack/react-query"

export type Operator = {
	name: string
	email: string
}

// Mock data until the operator profile API endpoint exists.
const MOCK_OPERATOR: Operator = {
	name: "Talqo Operator",
	email: "operator@talqo.dev",
}

export function useOperator() {
	return useQuery({
		queryKey: ["operator"],
		queryFn: () => Promise.resolve(MOCK_OPERATOR),
		staleTime: Number.POSITIVE_INFINITY,
	})
}
