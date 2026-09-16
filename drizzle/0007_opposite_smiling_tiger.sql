CREATE TABLE "webhook_calls" (
	"workflow_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "webhook_calls_workflow_id_window_start_pk" PRIMARY KEY("workflow_id","window_start")
);
--> statement-breakpoint
ALTER TABLE "webhook_calls" ADD CONSTRAINT "webhook_calls_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;