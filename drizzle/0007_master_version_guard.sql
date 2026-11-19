CREATE FUNCTION solva_check_master_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cur bigint;
BEGIN
  SELECT version INTO cur FROM tenant_sync WHERE tenant_id = NEW.tenant_id;
  IF cur IS NULL OR NEW.version IS DISTINCT FROM cur THEN
    RAISE EXCEPTION 'master row version % does not match tenant_sync version % (write master via sync.writeMaster)', NEW.version, cur;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION solva_enable_master_version_guard(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS master_version_guard ON %s', tbl);
  EXECUTE format(
    'CREATE TRIGGER master_version_guard BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION solva_check_master_version()',
    tbl
  );
END $$;
--> statement-breakpoint
SELECT solva_enable_master_version_guard('legal_entity');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('outlet');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('tax_rate_history');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('cash_master');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('register_invoice_prefix');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('outlet_receipt_setting');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('payment_method');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('app_user');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('role');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('role_permission');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('user_outlet');
