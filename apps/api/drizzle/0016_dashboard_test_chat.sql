CREATE TYPE "public"."conversation_origin" AS ENUM('embed', 'dashboard');--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "embed_access_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempt" ALTER COLUMN "network_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "origin" "conversation_origin" DEFAULT 'embed' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "operator_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_operator_id_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_operator_id_idx" ON "conversation" USING btree ("operator_id");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_origin_identity_check" CHECK (CASE "conversation"."origin" WHEN 'embed' THEN "conversation"."embed_access_version" IS NOT NULL AND "conversation"."operator_id" IS NULL ELSE "conversation"."embed_id" IS NULL AND "conversation"."embed_access_version" IS NULL END);