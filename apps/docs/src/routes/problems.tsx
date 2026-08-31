import { PROBLEMS } from "@/lib/problem-catalog.ts"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/problems")({
	component: ProblemsPage,
})

function ProblemsPage() {
	return (
		<main className="mx-auto max-w-3xl px-6 py-12">
			<h1 className="text-3xl font-semibold">API problem types</h1>
			<p className="text-fd-muted-foreground mt-3">
				Talqo API errors use RFC 9457 problem details. The type URI is the primary identifier; the code is a stable
				localization key.
			</p>
			<div className="mt-10 space-y-10">
				{PROBLEMS.map((problem) => (
					<section id={problem.code} key={problem.code} className="scroll-mt-6 border-t pt-6">
						<h2 className="text-xl font-semibold">{problem.title}</h2>
						<code className="mt-2 block text-sm">{problem.code}</code>
						<p className="mt-3">{problem.meaning}</p>
						<p className="mt-2">
							<strong>Status:</strong> {problem.status}
						</p>
						<p className="mt-2">
							<strong>Resolution:</strong> {problem.guidance}
						</p>
						<p className="mt-2 text-sm break-all">
							<strong>Type:</strong> https://docs.talqo.chat/problems#{problem.code}
						</p>
					</section>
				))}
			</div>
		</main>
	)
}
