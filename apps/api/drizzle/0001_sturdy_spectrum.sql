CREATE TYPE "public"."agent_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blacklist_word" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"word" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blacklist_word" ADD CONSTRAINT "blacklist_word_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_owner_id_idx" ON "agent" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blacklist_word_agent_id_word_idx" ON "blacklist_word" USING btree ("agent_id","word");--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;