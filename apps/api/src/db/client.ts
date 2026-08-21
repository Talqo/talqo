import { env } from "@/config/env.ts"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

export const sql = postgres(env.DATABASE_URL)
export const db = drizzle({ client: sql })
