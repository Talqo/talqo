import { plugin } from "bun"
import path from "node:path"

plugin({
	name: "talqo-svg-stub",
	setup(build) {
		build.onResolve({ filter: /\.svg\?react$/ }, () => ({
			path: path.resolve(import.meta.dir, "svg-stub-component.ts"),
		}))
	},
})
