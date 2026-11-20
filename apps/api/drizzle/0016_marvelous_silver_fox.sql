SET LOCAL lock_timeout = '3s';--> statement-breakpoint
ALTER TABLE "generation_attempt" ADD COLUMN "client_manifest_fingerprint" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "message" SET "parts" = jsonb_build_array(jsonb_build_object('type', 'text', 'text', "text")) WHERE "text" <> '' AND "parts" = '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "text";
