ALTER TABLE "embed" ALTER COLUMN "theme_toggle_enabled" SET DEFAULT false;--> statement-breakpoint
CREATE INDEX "conversation_agent_id_created_at_idx" ON "conversation" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "message_created_at_idx" ON "message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_record_agent_id_created_at_idx" ON "usage_record" USING btree ("agent_id","created_at");