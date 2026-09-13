CREATE TYPE "public"."conversation_final_outcome" AS ENUM('completed', 'failed', 'cancelled', 'blocked', 'interrupted');--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "latest_completed_message_id" text;--> statement-breakpoint
ALTER TABLE "conversation_attempt" ADD COLUMN "provider_invoked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_attempt" ADD COLUMN "final_outcome" "conversation_final_outcome";--> statement-breakpoint
ALTER TABLE "conversation_attempt" ADD COLUMN "usage_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "conversation_attempt" ADD COLUMN "usage_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "conversation_attempt" ADD COLUMN "usage_recorded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "conversation_attempt_usage_pending_idx" ON "conversation_attempt" USING btree ("provider_invoked","usage_recorded_at");--> statement-breakpoint
ALTER TABLE "conversation_attempt" ADD CONSTRAINT "conversation_attempt_usage_candidate_pair_check" CHECK (("conversation_attempt"."usage_input_tokens" IS NULL) = ("conversation_attempt"."usage_output_tokens" IS NULL));