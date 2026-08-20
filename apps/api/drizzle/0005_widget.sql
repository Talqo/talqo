CREATE TYPE "public"."widget_position" AS ENUM('bottom-right', 'bottom-left');--> statement-breakpoint
CREATE TYPE "public"."widget_theme" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TABLE "widget" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"public_token" text NOT NULL,
	"primary_color" text NOT NULL,
	"primary_foreground_color" text NOT NULL,
	"background_color" text NOT NULL,
	"foreground_color" text NOT NULL,
	"position" "widget_position" DEFAULT 'bottom-right' NOT NULL,
	"theme" "widget_theme" DEFAULT 'system' NOT NULL,
	"theme_toggle_enabled" boolean DEFAULT true NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "widget_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
ALTER TABLE "widget" ADD CONSTRAINT "widget_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "widget_agent_id_idx" ON "widget" USING btree ("agent_id");