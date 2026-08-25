CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text NOT NULL,
	"embed_token" uuid DEFAULT gen_random_uuid() NOT NULL,
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
ALTER TABLE "blacklist_word" ADD CONSTRAINT "blacklist_word_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_name_unique_idx" ON "agent" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "agent_embed_token_unique_idx" ON "agent" USING btree ("embed_token");--> statement-breakpoint
CREATE INDEX "blacklist_word_agent_id_idx" ON "blacklist_word" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blacklist_word_agent_word_unique_idx" ON "blacklist_word" USING btree ("agent_id",lower("word"));