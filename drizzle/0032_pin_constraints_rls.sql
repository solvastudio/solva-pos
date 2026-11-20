-- Master version guard for Class M staff_pin table
SELECT solva_enable_master_version_guard('staff_pin');
--> statement-breakpoint
-- Enable + FORCE Row Level Security on all 3 PIN tables
SELECT solva_enable_tenant_rls('user_pin_credential');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('staff_pin');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('staff_pin_state');
--> statement-breakpoint
-- Least-privilege grants for solva_app (never GRANT DELETE)
SELECT solva_grant_app('user_pin_credential', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('staff_pin', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('staff_pin_state', 'SELECT, INSERT, UPDATE');
