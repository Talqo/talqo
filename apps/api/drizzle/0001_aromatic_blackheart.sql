CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"word_blacklist" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_file" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"original_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_file" ADD CONSTRAINT "agent_file_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_owner_name_unique_idx" ON "agent" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "agent_owner_id_idx" ON "agent" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agent_file_agent_id_idx" ON "agent_file" USING btree ("agent_id");