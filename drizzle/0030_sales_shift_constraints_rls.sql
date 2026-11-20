-- 1. Required extension for invoice_gap EXCLUDE constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- 2. Cross-module & composite tenant-scoped Foreign Keys
ALTER TABLE "cash_cashier" ADD CONSTRAINT "fk_cash_cashier__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_cashier" ADD CONSTRAINT "fk_cash_cashier__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_cashier" ADD CONSTRAINT "fk_cash_cashier__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_cashier" ADD CONSTRAINT "fk_cash_cashier__device" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_cashier" ADD CONSTRAINT "fk_cash_cashier__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_cashier" ADD CONSTRAINT "fk_cash_cashier__command" FOREIGN KEY ("tenant_id", "command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_cashier" ADD CONSTRAINT "fk_cash_cashier__close_command" FOREIGN KEY ("tenant_id", "close_command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_cashier" ADD CONSTRAINT "fk_cash_cashier__force_closed_by" FOREIGN KEY ("tenant_id", "force_closed_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "fk_cash_movement__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "fk_cash_movement__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "fk_cash_movement__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "fk_cash_movement__device" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "fk_cash_movement__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "fk_cash_movement__command" FOREIGN KEY ("tenant_id", "command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__device" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__command" FOREIGN KEY ("tenant_id", "command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__shift" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "cash_cashier" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__legal_entity" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entity" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__tax_rate" FOREIGN KEY ("tenant_id", "tax_rate_id") REFERENCES "tax_rate_history" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__discount_approved_by" FOREIGN KEY ("tenant_id", "discount_approved_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__voided_by" FOREIGN KEY ("tenant_id", "voided_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__void_approved_by" FOREIGN KEY ("tenant_id", "void_approved_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__void_command" FOREIGN KEY ("tenant_id", "void_command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "fk_sale_line__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "fk_sale_line__product" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "fk_sale_line__sku" FOREIGN KEY ("tenant_id", "sku_id") REFERENCES "sku" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "fk_sale_line__uom" FOREIGN KEY ("tenant_id", "uom_id") REFERENCES "uom" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "fk_sale_line__discount_approved_by" FOREIGN KEY ("tenant_id", "discount_approved_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_payment" ADD CONSTRAINT "fk_sale_payment__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_payment" ADD CONSTRAINT "fk_sale_payment__shift" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "cash_cashier" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_payment" ADD CONSTRAINT "fk_sale_payment__method" FOREIGN KEY ("tenant_id", "method_id") REFERENCES "payment_method" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "fk_credit_note__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "fk_credit_note__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "fk_credit_note__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "fk_credit_note__device" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "fk_credit_note__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "fk_credit_note__approved_by" FOREIGN KEY ("tenant_id", "approved_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "fk_credit_note__command" FOREIGN KEY ("tenant_id", "command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "fk_credit_note__shift" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "cash_cashier" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note_line" ADD CONSTRAINT "fk_credit_note_line__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note_refund" ADD CONSTRAINT "fk_credit_note_refund__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note_refund" ADD CONSTRAINT "fk_credit_note_refund__shift" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "cash_cashier" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credit_note_refund" ADD CONSTRAINT "fk_credit_note_refund__method" FOREIGN KEY ("tenant_id", "method_id") REFERENCES "payment_method" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "fk_invoice_series__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "fk_invoice_series__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "fk_invoice_series__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "register_recovery" ADD CONSTRAINT "fk_register_recovery__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "register_recovery" ADD CONSTRAINT "fk_register_recovery__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "register_recovery" ADD CONSTRAINT "fk_register_recovery__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "register_recovery" ADD CONSTRAINT "fk_register_recovery__old_device" FOREIGN KEY ("tenant_id", "old_device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "register_recovery" ADD CONSTRAINT "fk_register_recovery__new_device" FOREIGN KEY ("tenant_id", "new_device_id") REFERENCES "device" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "register_recovery" ADD CONSTRAINT "fk_register_recovery__performed_by" FOREIGN KEY ("tenant_id", "performed_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "invoice_gap" ADD CONSTRAINT "fk_invoice_gap__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "invoice_gap" ADD CONSTRAINT "fk_invoice_gap__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "invoice_gap" ADD CONSTRAINT "fk_invoice_gap__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "invoice_gap" ADD CONSTRAINT "fk_invoice_gap__explained_by" FOREIGN KEY ("tenant_id", "explained_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
-- 3. Non-overlapping active gap EXCLUDE constraint & operational covering indexes (SCHEMA §4.5.9, §5.2.2)
ALTER TABLE "invoice_gap"
  ADD CONSTRAINT "ex_invoice_gap__active_range"
  EXCLUDE USING gist (
    "register_id" WITH =,
    "doc_type" WITH =,
    "period" WITH =,
    int4range("seq_from", "seq_to", '[]') WITH &&
  )
  WHERE ("status" <> 'FILLED');
--> statement-breakpoint
CREATE INDEX "ix_sale__tenant_outlet_bd_cov"
  ON "sale" ("tenant_id", "outlet_id", "business_date") INCLUDE ("status", "total_due");
--> statement-breakpoint
CREATE INDEX "ix_sale_payment__shift_kind_cov"
  ON "sale_payment" ("shift_id", "method_kind") INCLUDE ("amount_applied");
--> statement-breakpoint
CREATE INDEX "ix_credit_note_line__sale_line_cov"
  ON "credit_note_line" ("sale_line_id") INCLUDE ("qty_returned");
--> statement-breakpoint
CREATE INDEX "ix_cash_movement__shift_cov"
  ON "cash_movement" ("shift_id") INCLUDE ("direction", "amount");
--> statement-breakpoint
-- 4. Guard triggers (write-once blind count, code immutability after tx, base UOM immutability, layered fact guard)
CREATE FUNCTION cash_cashier_count_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.count_submitted_at IS NOT NULL AND (
    NEW.counted_cash IS DISTINCT FROM OLD.counted_cash OR
    NEW.count_submitted_at IS DISTINCT FROM OLD.count_submitted_at
  ) THEN
    RAISE EXCEPTION 'counted_cash is write-once after count_submitted_at is set';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_cashier_count_write_once_trg
  BEFORE UPDATE ON "cash_cashier"
  FOR EACH ROW EXECUTE FUNCTION cash_cashier_count_write_once();
--> statement-breakpoint
CREATE FUNCTION outlet_code_immutable_after_tx() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    IF EXISTS (SELECT 1 FROM "sale" WHERE "tenant_id" = OLD.tenant_id AND "outlet_id" = OLD.id LIMIT 1)
       OR EXISTS (SELECT 1 FROM "cash_cashier" WHERE "tenant_id" = OLD.tenant_id AND "outlet_id" = OLD.id LIMIT 1) THEN
      RAISE EXCEPTION 'outlet.code cannot be changed after transactions exist';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outlet_code_immutable_after_tx_trg
  BEFORE UPDATE OF "code" ON "outlet"
  FOR EACH ROW EXECUTE FUNCTION outlet_code_immutable_after_tx();
--> statement-breakpoint
CREATE FUNCTION cash_master_code_immutable_after_tx() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    IF EXISTS (SELECT 1 FROM "sale" WHERE "tenant_id" = OLD.tenant_id AND "register_id" = OLD.id LIMIT 1)
       OR EXISTS (SELECT 1 FROM "cash_cashier" WHERE "tenant_id" = OLD.tenant_id AND "register_id" = OLD.id LIMIT 1)
       OR EXISTS (SELECT 1 FROM "credit_note" WHERE "tenant_id" = OLD.tenant_id AND "register_id" = OLD.id LIMIT 1) THEN
      RAISE EXCEPTION 'cash_master.code cannot be changed after transactions exist';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_master_code_immutable_after_tx_trg
  BEFORE UPDATE OF "code" ON "cash_master"
  FOR EACH ROW EXECUTE FUNCTION cash_master_code_immutable_after_tx();
--> statement-breakpoint
CREATE FUNCTION product_base_uom_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_uom_id IS DISTINCT FROM OLD.base_uom_id THEN
    IF EXISTS (SELECT 1 FROM "sale_line" WHERE "tenant_id" = OLD.tenant_id AND "product_id" = OLD.id LIMIT 1) THEN
      RAISE EXCEPTION 'product.base_uom_id cannot be changed after transactions exist';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_base_uom_immutable_trg
  BEFORE UPDATE OF "base_uom_id" ON "product"
  FOR EACH ROW EXECUTE FUNCTION product_base_uom_immutable();
--> statement-breakpoint
CREATE FUNCTION sale_immutable_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
     OR NEW.register_id IS DISTINCT FROM OLD.register_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at_device IS DISTINCT FROM OLD.created_at_device
     OR NEW.clock_offset_ms IS DISTINCT FROM OLD.clock_offset_ms
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.command_id IS DISTINCT FROM OLD.command_id
     OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
     OR NEW.app_version IS DISTINCT FROM OLD.app_version
     OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
     OR NEW.invoice_prefix IS DISTINCT FROM OLD.invoice_prefix
     OR NEW.invoice_period IS DISTINCT FROM OLD.invoice_period
     OR NEW.invoice_seq IS DISTINCT FROM OLD.invoice_seq
     OR NEW.invoice_conflict_idx IS DISTINCT FROM OLD.invoice_conflict_idx
     OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
     OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
     OR NEW.bill_id IS DISTINCT FROM OLD.bill_id
     OR NEW.bill_ref IS DISTINCT FROM OLD.bill_ref
     OR NEW.price_tax_mode IS DISTINCT FROM OLD.price_tax_mode
     OR NEW.tax_profile IS DISTINCT FROM OLD.tax_profile
     OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
     OR NEW.service_charge_rate IS DISTINCT FROM OLD.service_charge_rate
     OR NEW.service_charge_taxable IS DISTINCT FROM OLD.service_charge_taxable
     OR NEW.cash_rounding_unit IS DISTINCT FROM OLD.cash_rounding_unit
     OR NEW.tax_rate_id IS DISTINCT FROM OLD.tax_rate_id
     OR NEW.receipt_locale IS DISTINCT FROM OLD.receipt_locale
     OR NEW.legal_entity_npwp IS DISTINCT FROM OLD.legal_entity_npwp
     OR NEW.legal_entity_is_pkp IS DISTINCT FROM OLD.legal_entity_is_pkp
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.gross_total IS DISTINCT FROM OLD.gross_total
     OR NEW.line_discount_total IS DISTINCT FROM OLD.line_discount_total
     OR NEW.bill_discount_type IS DISTINCT FROM OLD.bill_discount_type
     OR NEW.bill_discount_pct IS DISTINCT FROM OLD.bill_discount_pct
     OR NEW.bill_discount_input IS DISTINCT FROM OLD.bill_discount_input
     OR NEW.bill_discount_total IS DISTINCT FROM OLD.bill_discount_total
     OR NEW.discount_approved_by IS DISTINCT FROM OLD.discount_approved_by
     OR NEW.net_subtotal IS DISTINCT FROM OLD.net_subtotal
     OR NEW.service_charge IS DISTINCT FROM OLD.service_charge
     OR NEW.tax_base IS DISTINCT FROM OLD.tax_base
     OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
     OR NEW.dpp IS DISTINCT FROM OLD.dpp
     OR NEW.grand_total IS DISTINCT FROM OLD.grand_total
     OR NEW.rounding IS DISTINCT FROM OLD.rounding
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
     OR NEW.catalog_cursor IS DISTINCT FROM OLD.catalog_cursor THEN
    RAISE EXCEPTION 'sale immutable fact columns cannot be modified';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sale_immutable_facts_trg
  BEFORE UPDATE ON "sale"
  FOR EACH ROW EXECUTE FUNCTION sale_immutable_facts();
--> statement-breakpoint
-- 5. Enable + FORCE Row Level Security on all 11 tables
SELECT solva_enable_tenant_rls('cash_cashier');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('cash_movement');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('sale');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('sale_line');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('sale_payment');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('credit_note');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('credit_note_line');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('credit_note_refund');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('invoice_series');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('invoice_gap');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('register_recovery');
--> statement-breakpoint
-- 6. Column-level GRANT privileges for solva_app (SCHEMA §5.5; never GRANT DELETE on transactions)
SELECT solva_grant_app('sale', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (status, voided_at, voided_by, void_approved_by, void_reason_code, void_reason_text, void_command_id, cost_total) ON "sale" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('sale_line', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (cost_snapshot) ON "sale_line" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('sale_payment', 'SELECT, INSERT');
--> statement-breakpoint
SELECT solva_grant_app('credit_note', 'SELECT, INSERT');
--> statement-breakpoint
SELECT solva_grant_app('credit_note_line', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (cost_returned) ON "credit_note_line" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('credit_note_refund', 'SELECT, INSERT');
--> statement-breakpoint
SELECT solva_grant_app('cash_cashier', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (status, closed_at, closed_at_device, close_command_id, counted_cash, count_submitted_at, expected_cash_device, variance_device, expected_cash, variance, recap_cash_sales, recap_cash_in, recap_cash_out, recap_cash_refund, recap_status, recap_computed_at, force_closed_by, force_close_reason_text, close_note) ON "cash_cashier" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('cash_movement', 'SELECT, INSERT');
--> statement-breakpoint
SELECT solva_grant_app('invoice_series', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('invoice_gap', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('register_recovery', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (new_device_id) ON "register_recovery" TO solva_app;
