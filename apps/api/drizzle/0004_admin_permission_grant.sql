INSERT INTO "permission_grant" ("id", "user_id", "permission", "agent_id", "granted_by", "granted_at")
SELECT gen_random_uuid()::text, "user_id", 'admin', NULL, NULL, "created_at"
FROM "user_role"
WHERE "role" = 'admin'
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "user_role" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "user_role" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_admin_unique_idx" ON "permission_grant" USING btree ("permission") WHERE "permission_grant"."permission" = 'admin' AND "permission_grant"."agent_id" IS NULL;--> statement-breakpoint
DROP TYPE "public"."role";