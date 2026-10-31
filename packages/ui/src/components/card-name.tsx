import { CardTitle } from "@talqo/ui/components/card"

function CardName({ children }: { children: string }) {
	return (
		<CardTitle level={2} className="min-w-0">
			<span className="block truncate" title={children}>
				{children}
			</span>
		</CardTitle>
	)
}

export { CardName }
