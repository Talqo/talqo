CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_pk" PRIMARY KEY("role_id","permission"),
	CONSTRAINT "role_permission_not_admin" CHECK ("role_permission"."permission" <> 'admin')
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "user_role_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
DROP INDEX "permission_grant_admin_unique_idx";--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_name_unique_idx" ON "role" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "user_role_role_id_idx" ON "user_role" USING btree ("role_id");--> statement-breakpoint
-- Data conversion added to this generated migration so existing global access survives the upgrade.
INSERT INTO "role" ("id", "name")
SELECT 'migrated:' || u."id", 'Migrated access: ' || u."username" ||
	CASE WHEN count(*) OVER (PARTITION BY lower(u."username")) > 1
		THEN ' (' || row_number() OVER (PARTITION BY lower(u."username") ORDER BY u."id") || ')'
		ELSE '' END
FROM "user" u
WHERE EXISTS (
	SELECT 1 FROM "permission_grant" g
	WHERE g."user_id" = u."id" AND g."agent_id" IS NULL AND g."permission" <> 'admin'
);
--> statement-breakpoint
INSERT INTO "role_permission" ("role_id", "permission")
SELECT DISTINCT 'migrated:' || "user_id", "permission" FROM "permission_grant"
WHERE "agent_id" IS NULL AND "permission" <> 'admin';
--> statement-breakpoint
INSERT INTO "user_role" ("user_id", "role_id")
SELECT DISTINCT "user_id", 'migrated:' || "user_id" FROM "permission_grant"
WHERE "agent_id" IS NULL AND "permission" <> 'admin';
--> statement-breakpoint
-- Scoped grants were already ignored by authorization; do not turn them into global access.
DELETE FROM "permission_grant" WHERE "agent_id" IS NOT NULL OR "permission" <> 'admin';
--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_admin_unique_idx" ON "permission_grant" USING btree ("permission") WHERE "permission_grant"."permission" = 'admin';--> statement-breakpoint
ALTER TABLE "permission_grant" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_admin_only" CHECK ("permission_grant"."permission" = 'admin');
