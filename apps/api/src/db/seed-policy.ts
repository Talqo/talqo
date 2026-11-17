export function assertSeedAllowed(nodeEnv: string, allowInsecureSeed: string | undefined): void {
	if (nodeEnv !== "development" && nodeEnv !== "test") {
		throw new Error("Database seeding is available only in development or test")
	}
	if (allowInsecureSeed !== "true") {
		throw new Error("TALQO_ALLOW_INSECURE_SEED=true is required to create development fixtures")
	}
}
