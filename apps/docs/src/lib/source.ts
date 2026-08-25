// @boundaries-ignore turbo cannot resolve the collections/* alias into fumadocs-generated, gitignored .source output
import { docs } from "collections/server"
import { loader } from "fumadocs-core/source"

export const source = loader({
	baseUrl: "/docs",
	source: docs.toFumadocsSource(),
})
