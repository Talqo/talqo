CREATE TABLE "agent_file" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"model_key" text,
	"generation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_file_chunk" (
	"file_id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector NOT NULL,
	CONSTRAINT "agent_file_chunk_file_id_position_pk" PRIMARY KEY("file_id","position")
);
--> statement-breakpoint
ALTER TABLE "agent_file" ADD CONSTRAINT "agent_file_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_file_chunk" ADD CONSTRAINT "agent_file_chunk_file_id_agent_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."agent_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_file_agent_name_idx" ON "agent_file" USING btree ("agent_id","name");--> statement-breakpoint
CREATE INDEX "agent_file_status_idx" ON "agent_file" USING btree ("status");