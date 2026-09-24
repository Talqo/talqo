ALTER TABLE "generation_attempt" ALTER COLUMN "estimated_input_tokens" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempt" DROP COLUMN "input_text";