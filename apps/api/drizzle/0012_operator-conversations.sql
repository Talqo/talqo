ALTER TABLE "conversation" ADD COLUMN "reference_id" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_created_at_idx" ON "conversation" USING btree ("created_at","reference_id");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_reference_id_unique" UNIQUE("reference_id");