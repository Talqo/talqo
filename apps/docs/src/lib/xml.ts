export function escapeXml(value: string): string {
	return value.replaceAll(/[<>&'"]/g, (character) => {
		switch (character) {
			case "<":
				return "&lt;"
			case ">":
				return "&gt;"
			case "&":
				return "&amp;"
			case "'":
				return "&apos;"
			default:
				return "&quot;"
		}
	})
}
