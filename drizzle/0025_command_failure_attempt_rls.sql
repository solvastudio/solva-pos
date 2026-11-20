ALTER TABLE "command_failure_attempt"
  ADD CONSTRAINT "fk_command_failure_attempt__tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
SELECT solva_enable_tenant_rls('command_failure_attempt');
--> statement-breakpoint
SELECT solva_grant_app('command_failure_attempt', 'SELECT, INSERT, UPDATE, DELETE');
