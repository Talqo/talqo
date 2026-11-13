ALTER TABLE "generation_attempt" ADD COLUMN "client_manifest_fingerprint" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "message" SET "parts" = CASE WHEN "text" = '' THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'text', "text")) END;--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "text";
