import { fixOrvalZodImports } from "./fix-orval-zod-imports.ts"

const target = Bun.argv[2]
if (!target) throw new Error("Generated Orval directory is required")

// Orval 8.24 loses Zod value-import metadata in React Query output. Remove after upstream output typechecks unchanged.
const changedFiles = await fixOrvalZodImports(target)
console.log(`Promoted Zod imports in ${changedFiles} generated files`)
