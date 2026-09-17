CREATE TYPE "public"."conversation_attempt_status" AS ENUM('accepted', 'running', 'completed', 'failed', 'cancelled', 'blocked', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."conversation_final_outcome" AS ENUM('completed', 'failed', 'cancelled', 'blocked', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_outcome" AS ENUM('streaming', 'completed', 'failed', 'cancelled', 'blocked', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
ALTER TYPE "public"."widget_position" RENAME TO "embed_position";--> statement-breakpoint
ALTER TYPE "public"."widget_theme" RENAME TO "embed_theme";--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"embed_id" text,
	"embed_access_version" integer NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"latest_completed_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"request_id" text NOT NULL,
	"input_text" text NOT NULL,
	"status" "conversation_attempt_status" DEFAULT 'accepted' NOT NULL,
	"network_hash" text NOT NULL,
	"lease_token" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"provider" text,
	"model" text,
	"provider_invoked" boolean DEFAULT false NOT NULL,
	"final_outcome" "conversation_final_outcome",
	"usage_input_tokens" integer,
	"usage_output_tokens" integer,
	"usage_recorded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_attempt_usage_candidate_pair_check" CHECK (("conversation_attempt"."usage_input_tokens" IS NULL) = ("conversation_attempt"."usage_output_tokens" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "conversation_daily_counter" (
	"agent_id" text NOT NULL,
	"network_hash" text NOT NULL,
	"day" text NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"role" "conversation_message_role" NOT NULL,
	"text" text NOT NULL,
	"outcome" "conversation_message_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_usage" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "widget" RENAME TO "embed";--> statement-breakpoint
ALTER TABLE "embed" RENAME COLUMN "public_token" TO "embed_token";--> statement-breakpoint
ALTER TABLE "embed" DROP CONSTRAINT "widget_public_token_unique";--> statement-breakpoint
ALTER TABLE "embed" DROP CONSTRAINT "widget_agent_id_agent_id_fk";
--> statement-breakpoint
DROP INDEX "agent_embed_token_unique_idx";--> statement-breakpoint
DROP INDEX "widget_agent_id_idx";--> statement-breakpoint
ALTER TABLE "embed" ADD COLUMN "access_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_embed_id_embed_id_fk" FOREIGN KEY ("embed_id") REFERENCES "public"."embed"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attempt" ADD CONSTRAINT "conversation_attempt_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_daily_counter" ADD CONSTRAINT "conversation_daily_counter_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_attempt_id_conversation_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."conversation_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_usage" ADD CONSTRAINT "conversation_usage_attempt_id_conversation_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."conversation_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_usage" ADD CONSTRAINT "conversation_usage_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_usage" ADD CONSTRAINT "conversation_usage_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_agent_id_idx" ON "conversation" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "conversation_embed_id_idx" ON "conversation" USING btree ("embed_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_attempt_conversation_request_unique_idx" ON "conversation_attempt" USING btree ("conversation_id","request_id");--> statement-breakpoint
CREATE INDEX "conversation_attempt_active_network_idx" ON "conversation_attempt" USING btree ("network_hash","status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "conversation_attempt_conversation_id_idx" ON "conversation_attempt" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_attempt_usage_pending_idx" ON "conversation_attempt" USING btree ("provider_invoked","usage_recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_daily_counter_unique_idx" ON "conversation_daily_counter" USING btree ("agent_id","network_hash","day");--> statement-breakpoint
CREATE INDEX "conversation_message_order_idx" ON "conversation_message" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "conversation_usage_agent_id_idx" ON "conversation_usage" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "conversation_usage_conversation_id_idx" ON "conversation_usage" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "embed" ADD CONSTRAINT "embed_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embed_agent_id_idx" ON "embed" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "agent" DROP COLUMN "embed_token";--> statement-breakpoint
ALTER TABLE "embed" ADD CONSTRAINT "embed_embed_token_unique" UNIQUE("embed_token");