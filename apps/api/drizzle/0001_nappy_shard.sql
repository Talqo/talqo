CREATE TABLE "ai_provider_config" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"text_config" jsonb NOT NULL,
	"embedding_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_config_singleton_check" CHECK ("ai_provider_config"."id" = 'singleton')
);
