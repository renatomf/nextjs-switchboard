CREATE TABLE "workflow_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"environment" text NOT NULL,
	"preset" jsonb NOT NULL,
	"timezone" text NOT NULL,
	"trigger_schedule_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_schedules_workflow_id_environment_idx" ON "workflow_schedules" USING btree ("workflow_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_schedules_trigger_schedule_id_idx" ON "workflow_schedules" USING btree ("trigger_schedule_id");--> statement-breakpoint
CREATE INDEX "workflow_schedules_org_id_environment_idx" ON "workflow_schedules" USING btree ("org_id","environment");