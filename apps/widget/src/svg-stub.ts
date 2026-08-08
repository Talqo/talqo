import { plugin } from "bun"
import path from "node:path"

// bun test has no vite pipeline, so imports of *.svg?react never reach the
// svgr plugin; resolve them to a stub so the widget tests stay free of
// happy-dom "unrecognized tag" noise. Real icons come from vite-plugin-svgr.
plugin({
	name: "talqo-svg-stub",
	setup(build) {
		build.onResolve({ filter: /\.svg\?react$/ }, () => ({
			path: path.resolve(import.meta.dir, "svg-stub-component.ts"),
		}))
	},
})
