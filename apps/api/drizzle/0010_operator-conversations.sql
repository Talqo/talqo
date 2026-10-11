DROP INDEX "conversation_agent_id_idx";--> statement-breakpoint
ALTER TABLE "embed" ALTER COLUMN "theme_toggle_enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "reference_id" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_agent_created_idx" ON "conversation" USING btree ("agent_id","created_at","reference_id");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_reference_id_unique" UNIQUE("reference_id");