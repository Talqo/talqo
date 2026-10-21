CREATE TABLE "role_agent_permission" (
	"role_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_agent_permission_role_id_agent_id_permission_pk" PRIMARY KEY("role_id","agent_id","permission"),
	CONSTRAINT "role_agent_permission_catalog" CHECK ("role_agent_permission"."permission" in ('stats:read', 'conversations:read', 'agents:read', 'agents:manage', 'agents:delete'))
);
--> statement-breakpoint
ALTER TABLE "role_agent_permission" ADD CONSTRAINT "role_agent_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_agent_permission" ADD CONSTRAINT "role_agent_permission_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_agent_permission_agent_id_idx" ON "role_agent_permission" USING btree ("agent_id");
--> statement-breakpoint
DELETE FROM role_permission WHERE permission IN ('agents:read', 'agents:manage', 'conversations:read');
