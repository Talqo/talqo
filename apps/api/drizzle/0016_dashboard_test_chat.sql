ALTER TABLE "conversation" ALTER COLUMN "embed_access_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempt" ALTER COLUMN "network_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "operator_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_operator_id_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_operator_id_idx" ON "conversation" USING btree ("operator_id");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_identity_check" CHECK (CASE WHEN "conversation"."embed_access_version" IS NULL THEN "conversation"."embed_id" IS NULL ELSE "conversation"."operator_id" IS NULL END);