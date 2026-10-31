import { Card, CardDescription, CardHeader } from "@talqo/ui/components/card"

function MetricCard({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardHeader>
				<CardDescription>{label}</CardDescription>
				<p className="text-2xl font-medium">{value}</p>
			</CardHeader>
		</Card>
	)
}

export { MetricCard }
