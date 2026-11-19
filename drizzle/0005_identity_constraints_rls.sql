-- 1. Composite created_by / updated_by foreign keys to app_user(tenant_id, id) for all Class M identity tables
ALTER TABLE "legal_entity" ADD CONSTRAINT "fk_legal_entity__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "fk_legal_entity__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "outlet" ADD CONSTRAINT "fk_outlet__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "outlet" ADD CONSTRAINT "fk_outlet__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "tax_rate_history" ADD CONSTRAINT "fk_tax_rate_history__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "tax_rate_history" ADD CONSTRAINT "fk_tax_rate_history__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_master" ADD CONSTRAINT "fk_cash_master__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_master" ADD CONSTRAINT "fk_cash_master__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "register_invoice_prefix" ADD CONSTRAINT "fk_register_invoice_prefix__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "register_invoice_prefix" ADD CONSTRAINT "fk_register_invoice_prefix__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "outlet_receipt_setting" ADD CONSTRAINT "fk_outlet_receipt_setting__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "outlet_receipt_setting" ADD CONSTRAINT "fk_outlet_receipt_setting__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "fk_payment_method__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "fk_payment_method__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "fk_app_user__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "fk_app_user__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "fk_role__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "fk_role__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "fk_role_permission__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "fk_role_permission__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "user_outlet" ADD CONSTRAINT "fk_user_outlet__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "user_outlet" ADD CONSTRAINT "fk_user_outlet__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
-- 2. Partial unique index with NULLS NOT DISTINCT on user_outlet
CREATE UNIQUE INDEX "uq_user_outlet__user_outlet"
  ON "user_outlet" ("user_id", "outlet_id") NULLS NOT DISTINCT
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
-- 3. Trigger: outlet PPN tax profile requires PKP legal entity (BR-TAX-002)
CREATE FUNCTION outlet_check_ppn_requires_pkp() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_is_pkp boolean;
BEGIN
  IF NEW.tax_profile = 'PPN' THEN
    SELECT le.is_pkp INTO v_is_pkp
    FROM legal_entity le
    WHERE le.tenant_id = NEW.tenant_id
      AND le.id = NEW.legal_entity_id
      AND le.deleted_at IS NULL;
    IF COALESCE(v_is_pkp, false) = false THEN
      RAISE EXCEPTION 'PPN requires PKP legal entity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outlet_ppn_requires_pkp
  BEFORE INSERT OR UPDATE OF tax_profile, legal_entity_id ON "outlet"
  FOR EACH ROW EXECUTE FUNCTION outlet_check_ppn_requires_pkp();
--> statement-breakpoint
-- 4. Trigger: register_invoice_prefix uniqueness across registers within a tenant (BR-INV-003)
CREATE FUNCTION register_prefix_unique_per_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1
    FROM register_invoice_prefix rip
    WHERE rip.tenant_id = NEW.tenant_id
      AND rip.invoice_prefix = NEW.invoice_prefix
      AND rip.register_id <> NEW.register_id
      AND rip.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'invoice prefix already used by another register';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER register_invoice_prefix_tenant_unique
  BEFORE INSERT OR UPDATE OF invoice_prefix, register_id, deleted_at ON "register_invoice_prefix"
  FOR EACH ROW EXECUTE FUNCTION register_prefix_unique_per_tenant();
--> statement-breakpoint
-- 5. Enable + FORCE Row Level Security on all tenant-scoped identity tables
SELECT solva_enable_tenant_rls('legal_entity');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('outlet');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('tax_rate_history');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('cash_master');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('register_invoice_prefix');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('outlet_receipt_setting');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('payment_method');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('app_user');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('role');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('role_permission');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('user_outlet');
--> statement-breakpoint
-- 6. Grants for solva_app (no DELETE on tombstone tables; SELECT-only on global permission catalog)
SELECT solva_grant_app('legal_entity', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('outlet', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('tax_rate_history', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('cash_master', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('register_invoice_prefix', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('outlet_receipt_setting', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('payment_method', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('app_user', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('role', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('role_permission', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('user_outlet', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
GRANT SELECT ON "permission" TO solva_app;
-- Note: Triggers guarding outlet/register code immutability after transactions and register_type
-- immutability while shift/bill is OPEN will be added in Fase 40 and Fase 55 when those tables exist.
