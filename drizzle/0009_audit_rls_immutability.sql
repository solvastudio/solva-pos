-- 1. Foreign keys to tenant(id) and composite actor/approver FKs to app_user(tenant_id, id)
ALTER TABLE "audit_log" ADD CONSTRAINT "fk_audit_log__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "fk_audit_log__actor" FOREIGN KEY ("tenant_id", "actor_user_id") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "fk_audit_log__approver" FOREIGN KEY ("tenant_id", "approver_user_id") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "audit_chain_head" ADD CONSTRAINT "fk_audit_chain_head__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
-- 2. RLS: append-only policies on audit_log (SELECT & INSERT only); standard tenant RLS on audit_chain_head
SELECT solva_enable_tenant_rls_append_only('audit_log');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('audit_chain_head');
--> statement-breakpoint
-- 3. Grants for solva_app (no UPDATE/DELETE/TRUNCATE on audit_log)
REVOKE ALL ON "audit_log" FROM solva_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_log" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('audit_chain_head', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
-- 4. Multi-layered immutability triggers (even table owner fails UPDATE/DELETE/TRUNCATE)
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
