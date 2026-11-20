CREATE TABLE "command_failure_attempt" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_error_code" text NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "uq_command_failure_attempt__tenant_cmd" UNIQUE("tenant_id","command_id"),
	CONSTRAINT "ck_command_failure_attempt__count" CHECK ("command_failure_attempt"."attempt_count" >= 1)
);
--> statement-breakpoint
CREATE INDEX "ix_command_failure_attempt__tenant_updated" ON "command_failure_attempt" USING btree ("tenant_id","updated_at");