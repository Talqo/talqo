INSERT INTO "permission_grant" ("id", "user_id", "permission", "agent_id", "granted_by", "granted_at")
SELECT gen_random_uuid()::text, "user_id", 'admin', NULL, NULL, "created_at"
FROM "user_role"
WHERE "role" = 'admin'
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_admin_unique_idx" ON "permission_grant" ("permission") WHERE "permission" = 'admin' AND "agent_id" IS NULL;--> statement-breakpoint
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_user_id_user_id_fk";--> statement-breakpoint
DROP INDEX "user_role_admin_unique_idx";--> statement-breakpoint
DROP INDEX "user_role_user_id_idx";--> statement-breakpoint
DROP TABLE "user_role";--> statement-breakpoint
DROP TYPE "public"."role";
