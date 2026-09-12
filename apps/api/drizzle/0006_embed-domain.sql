ALTER TYPE "public"."widget_position" RENAME TO "embed_position";--> statement-breakpoint
ALTER TYPE "public"."widget_theme" RENAME TO "embed_theme";--> statement-breakpoint
ALTER TABLE "widget" RENAME TO "embed";--> statement-breakpoint
ALTER TABLE "embed" RENAME COLUMN "public_token" TO "embed_token";--> statement-breakpoint
ALTER TABLE "embed" DROP CONSTRAINT "widget_public_token_unique";--> statement-breakpoint
ALTER TABLE "embed" DROP CONSTRAINT "widget_agent_id_agent_id_fk";
--> statement-breakpoint
DROP INDEX "agent_embed_token_unique_idx";--> statement-breakpoint
DROP INDEX "widget_agent_id_idx";--> statement-breakpoint
ALTER TABLE "embed" ADD COLUMN "access_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "embed" ADD CONSTRAINT "embed_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embed_agent_id_idx" ON "embed" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "agent" DROP COLUMN "embed_token";--> statement-breakpoint
ALTER TABLE "embed" ADD CONSTRAINT "embed_embed_token_unique" UNIQUE("embed_token");