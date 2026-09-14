-- Hand-edited: the three type changes below say USING ... AT TIME ZONE 'UTC'.
-- Without it Postgres reads the old values in the session time zone of whoever
-- runs the migration. They were written by now() on a server set to UTC.
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"browserbase_session_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "executions_run_id_unique" UNIQUE("run_id"),
	CONSTRAINT "executions_status_check" CHECK ("executions"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "workflow_versions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflow_versions" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_version_id_workflow_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executions_workflow_id_created_at_idx" ON "executions" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "executions_version_id_idx" ON "executions" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_browserbase_session_id_idx" ON "executions" USING btree ("browserbase_session_id");