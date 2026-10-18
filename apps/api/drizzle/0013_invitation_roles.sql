CREATE TABLE "invitation_role" (
	"invitation_id" text NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "invitation_role_invitation_id_role_id_pk" PRIMARY KEY("invitation_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_role" ADD CONSTRAINT "invitation_role_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_role" ADD CONSTRAINT "invitation_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_role_role_id_idx" ON "invitation_role" USING btree ("role_id");
--> statement-breakpoint
INSERT INTO "role" ("id", "name")
SELECT 'default', candidate.name
FROM (
	SELECT n, CASE WHEN n = 1 THEN 'Default' ELSE 'Default ' || n::text END AS name
	FROM generate_series(1, (SELECT count(*)::integer + 1 FROM "role")) AS n
) AS candidate
WHERE NOT EXISTS (SELECT 1 FROM "role" WHERE lower("role"."name") = lower(candidate.name))
ORDER BY candidate.n
LIMIT 1;
