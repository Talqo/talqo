import { describe, expect, it } from "bun:test"

import { promoteZodImports } from "./fix-orval-zod-imports.ts"

describe("promoteZodImports", () => {
	it("promotes generated model imports without changing library type imports", () => {
		const source = `import type { QueryKey } from "@tanstack/react-query"

import type {
  Login200,
  LoginBody,
} from "../models/identity"
`

		expect(promoteZodImports(source)).toBe(`import type { QueryKey } from "@tanstack/react-query"

import {
  Login200,
  LoginBody,
} from "../models/identity"
`)
	})

	it("promotes a single-line generated model import", () => {
		expect(promoteZodImports('import type { Login200 } from "../models/identity/login200.zod"')).toBe(
			'import { Login200 } from "../models/identity/login200.zod"',
		)
	})

	it("promotes Orval's unformatted single-quoted import", () => {
		const source = `import type {
  Login200
} from '../models/identity/login200.zod';`

		expect(promoteZodImports(source)).toBe(`import {
  Login200
} from '../models/identity/login200.zod';`)
	})
})
