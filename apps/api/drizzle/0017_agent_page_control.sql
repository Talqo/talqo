ALTER TABLE "agent" ADD COLUMN "page_control_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "page_approval_instructions" text DEFAULT 'Browse, search, select products, prepare carts, and fill drafts without approval.
Ask before purchases, payments, important account changes, or actions with unclear consequences.' NOT NULL;