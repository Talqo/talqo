import { Hono } from "hono"

export const app = new Hono().get("/health", (context) => context.json({ status: "ok" }))
