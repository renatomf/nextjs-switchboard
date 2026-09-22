ALTER TABLE "executions" ADD COLUMN "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "cached_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "session_seconds" integer;