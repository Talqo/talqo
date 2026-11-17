import { expect, test } from "bun:test"

import { Route } from "./ai-configuration"

test("requires provider management", () => {
	expect(Route.options.beforeLoad?.({} as never)).toEqual({ requires: "ai_provider:manage" })
})
