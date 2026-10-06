CREATE TYPE "public"."mcp_auth_mode" AS ENUM('none', 'headers', 'oauth');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('http', 'stdio');--> statement-breakpoint
CREATE TABLE "mcp_server" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"transport" "mcp_transport" NOT NULL,
	"url" text,
	"auth_mode" "mcp_auth_mode",
	"headers" jsonb,
	"oauth_tokens" jsonb,
	"oauth_client" jsonb,
	"oauth_pending" jsonb,
	"oauth_state_expires_at" timestamp with time zone,
	"command" text,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_transport_fields_check" CHECK ((
				"mcp_server"."transport" = 'http' AND "mcp_server"."url" IS NOT NULL AND "mcp_server"."command" IS NULL
					AND "mcp_server"."auth_mode" IS NOT NULL
					AND "mcp_server"."args" = '[]'::jsonb AND "mcp_server"."env" = '{}'::jsonb
			) OR (
				"mcp_server"."transport" = 'stdio' AND "mcp_server"."command" IS NOT NULL AND "mcp_server"."url" IS NULL
					AND "mcp_server"."auth_mode" IS NULL
			)),
	CONSTRAINT "mcp_server_auth_fields_check" CHECK ((
				("mcp_server"."auth_mode" IS NULL OR "mcp_server"."auth_mode" = 'none')
					AND "mcp_server"."headers" IS NULL AND "mcp_server"."oauth_tokens" IS NULL
					AND "mcp_server"."oauth_client" IS NULL AND "mcp_server"."oauth_pending" IS NULL
					AND "mcp_server"."oauth_state_expires_at" IS NULL
			) OR (
				"mcp_server"."auth_mode" IS NOT DISTINCT FROM 'headers' AND "mcp_server"."headers" IS NOT NULL
					AND "mcp_server"."oauth_tokens" IS NULL AND "mcp_server"."oauth_client" IS NULL
					AND "mcp_server"."oauth_pending" IS NULL AND "mcp_server"."oauth_state_expires_at" IS NULL
			) OR (
				"mcp_server"."auth_mode" IS NOT DISTINCT FROM 'oauth' AND "mcp_server"."headers" IS NULL
					AND ("mcp_server"."oauth_pending" IS NULL) = ("mcp_server"."oauth_state_expires_at" IS NULL)
			))
);
--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_server_agent_id_idx" ON "mcp_server" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_agent_name_unique_idx" ON "mcp_server" USING btree ("agent_id",lower("name"));