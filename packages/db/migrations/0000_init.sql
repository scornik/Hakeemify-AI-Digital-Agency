CREATE TABLE "assets" (
	"asset_id" text NOT NULL,
	"site_id" text NOT NULL,
	"path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"aspect" double precision NOT NULL,
	"rights" text NOT NULL,
	"subject_consent" boolean NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"grade_safe" boolean DEFAULT false NOT NULL,
	"alt" text,
	"placeholder_data_uri" text,
	"graded_variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "assets_site_id_asset_id_pk" PRIMARY KEY("site_id","asset_id"),
	CONSTRAINT "assets_site_path_unique" UNIQUE("site_id","path")
);
--> statement-breakpoint
CREATE TABLE "diversity_ledger" (
	"window_start" timestamp with time zone NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"share" double precision NOT NULL,
	CONSTRAINT "diversity_ledger_window_start_key_value_pk" PRIMARY KEY("window_start","key","value")
);
--> statement-breakpoint
CREATE TABLE "edit_actions" (
	"action_id" text NOT NULL,
	"site_id" text NOT NULL,
	"version_id" text NOT NULL,
	"seq" integer NOT NULL,
	"action" jsonb NOT NULL,
	"inverse" jsonb NOT NULL,
	"txn_id" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edit_actions_site_id_action_id_pk" PRIMARY KEY("site_id","action_id"),
	CONSTRAINT "edit_actions_seq_unique" UNIQUE("site_id","version_id","seq")
);
--> statement-breakpoint
CREATE TABLE "fact_sources" (
	"source_id" text NOT NULL,
	"site_id" text NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"status_code" integer,
	"fetched_at" timestamp with time zone,
	"etag" text,
	"content_hash" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "fact_sources_site_id_source_id_pk" PRIMARY KEY("site_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"fact_id" text NOT NULL,
	"site_id" text NOT NULL,
	"path" text NOT NULL,
	"value" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"quotable" boolean DEFAULT false NOT NULL,
	"verification" text DEFAULT 'unverified' NOT NULL,
	CONSTRAINT "facts_site_id_fact_id_pk" PRIMARY KEY("site_id","fact_id"),
	CONSTRAINT "facts_site_path_unique" UNIQUE("site_id","path")
);
--> statement-breakpoint
CREATE TABLE "gate_reports" (
	"report_id" text NOT NULL,
	"site_id" text NOT NULL,
	"version_id" text NOT NULL,
	"policy_ver" text NOT NULL,
	"checks" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gate_reports_site_id_report_id_pk" PRIMARY KEY("site_id","report_id")
);
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"call_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_id" text NOT NULL,
	"stage" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"schema_hash" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"cost_usd" double precision NOT NULL,
	"duration_ms" integer NOT NULL,
	"finish_reason" text NOT NULL,
	"attempts" integer NOT NULL,
	"guardrail_codes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_calls_site_id_call_id_pk" PRIMARY KEY("site_id","call_id")
);
--> statement-breakpoint
CREATE TABLE "priors" (
	"arrangement_id" text NOT NULL,
	"stratum" jsonb NOT NULL,
	"status" text DEFAULT 'insufficient' NOT NULL,
	"evidence" jsonb NOT NULL,
	"window" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "priors_arrangement_id_window_pk" PRIMARY KEY("arrangement_id","window")
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"event_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_id" text NOT NULL,
	"parent_id" text,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_site_id_event_id_pk" PRIMARY KEY("site_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"run_id" text NOT NULL,
	"site_id" text NOT NULL,
	"version_id" text,
	"stage" text NOT NULL,
	"status" text DEFAULT 'IDLE' NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"iterations" integer DEFAULT 0 NOT NULL,
	"seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_site_id_run_id_pk" PRIMARY KEY("site_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "site_versions" (
	"version_id" text NOT NULL,
	"site_id" text NOT NULL,
	"parent_version_id" text,
	"site_definition" jsonb NOT NULL,
	"manifest" jsonb NOT NULL,
	"gap_report" jsonb NOT NULL,
	"gate_report_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"pinned" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_versions_site_id_version_id_pk" PRIMARY KEY("site_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"site_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"niche" text NOT NULL,
	"positioning" text,
	"published_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"event_id" text NOT NULL,
	"site_id" text NOT NULL,
	"version_id" text,
	"kind" text NOT NULL,
	"section_instance_id" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_events_site_id_event_id_pk" PRIMARY KEY("site_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_actions" ADD CONSTRAINT "edit_actions_version_fk" FOREIGN KEY ("site_id","version_id") REFERENCES "public"."site_versions"("site_id","version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_reports" ADD CONSTRAINT "gate_reports_version_fk" FOREIGN KEY ("site_id","version_id") REFERENCES "public"."site_versions"("site_id","version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_run_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."runs"("site_id","run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."runs"("site_id","run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_parent_fk" FOREIGN KEY ("site_id","parent_id") REFERENCES "public"."run_events"("site_id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_version_fk" FOREIGN KEY ("site_id","version_id") REFERENCES "public"."site_versions"("site_id","version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_parent_fk" FOREIGN KEY ("site_id","parent_version_id") REFERENCES "public"."site_versions"("site_id","version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_sources_hash_idx" ON "fact_sources" USING btree ("site_id","content_hash");--> statement-breakpoint
CREATE INDEX "facts_quotable_idx" ON "facts" USING btree ("site_id","quotable");--> statement-breakpoint
CREATE INDEX "model_calls_run_idx" ON "model_calls" USING btree ("site_id","run_id");--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("site_id","run_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "site_versions_one_published" ON "site_versions" USING btree ("site_id") WHERE status = 'published';--> statement-breakpoint
CREATE INDEX "site_versions_site_idx" ON "site_versions" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "sites_tenant_idx" ON "sites" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "telemetry_kind_idx" ON "telemetry_events" USING btree ("site_id","kind","created_at");