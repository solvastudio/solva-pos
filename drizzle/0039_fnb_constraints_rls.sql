-- 1. Cross-module & self-referential composite FKs (SCHEMA §4.2.9-4.2.11, §4.5.5, §4.5.11-4.5.14)
ALTER TABLE "modifier_group" ADD CONSTRAINT "fk_modifier_group__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier_group" ADD CONSTRAINT "fk_modifier_group__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier_group" ADD CONSTRAINT "fk_modifier_group__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier_group_product" ADD CONSTRAINT "fk_modifier_group_product__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier_group_product" ADD CONSTRAINT "fk_modifier_group_product__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier_group_product" ADD CONSTRAINT "fk_modifier_group_product__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier" ADD CONSTRAINT "fk_modifier__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier" ADD CONSTRAINT "fk_modifier__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier" ADD CONSTRAINT "fk_modifier__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier_ingredient" ADD CONSTRAINT "fk_modifier_ingredient__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier_ingredient" ADD CONSTRAINT "fk_modifier_ingredient__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "modifier_ingredient" ADD CONSTRAINT "fk_modifier_ingredient__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "recipe_item" ADD CONSTRAINT "fk_recipe_item__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "recipe_item" ADD CONSTRAINT "fk_recipe_item__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "recipe_item" ADD CONSTRAINT "fk_recipe_item__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fnb_table" ADD CONSTRAINT "fk_fnb_table__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fnb_table" ADD CONSTRAINT "fk_fnb_table__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fnb_table" ADD CONSTRAINT "fk_fnb_table__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fnb_table" ADD CONSTRAINT "fk_fnb_table__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__device" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__command" FOREIGN KEY ("tenant_id", "command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__lease_device" FOREIGN KEY ("tenant_id", "lease_device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__lease_register" FOREIGN KEY ("tenant_id", "lease_register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__handover_target_register" FOREIGN KEY ("tenant_id", "handover_target_register_id") REFERENCES "cash_master" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__handover_event" FOREIGN KEY ("tenant_id", "handover_event_id") REFERENCES "bill_event" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__parent_bill" FOREIGN KEY ("tenant_id", "parent_bill_id") REFERENCES "bill" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__merged_into_bill" FOREIGN KEY ("tenant_id", "merged_into_bill_id") REFERENCES "bill" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__discount_approved_by" FOREIGN KEY ("tenant_id", "bill_discount_approved_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__device" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__register" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__staff" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__origin_bill" FOREIGN KEY ("tenant_id", "origin_bill_id") REFERENCES "bill" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__target_register" FOREIGN KEY ("tenant_id", "target_register_id") REFERENCES "cash_master" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__handover_event" FOREIGN KEY ("tenant_id", "handover_event_id") REFERENCES "bill_event" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__command" FOREIGN KEY ("tenant_id", "command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__sku" FOREIGN KEY ("tenant_id", "sku_id") REFERENCES "sku" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__sku_uom" FOREIGN KEY ("sku_id", "uom_id") REFERENCES "sku_uom" ("sku_id", "uom_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__discount_approved_by" FOREIGN KEY ("tenant_id", "discount_approved_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__origin_bill" FOREIGN KEY ("tenant_id", "origin_bill_id") REFERENCES "bill" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__origin_item" FOREIGN KEY ("tenant_id", "origin_item_id") REFERENCES "bill_item" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item_modifier" ADD CONSTRAINT "fk_bill_item_modifier__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bill_item_modifier" ADD CONSTRAINT "fk_bill_item_modifier__modifier" FOREIGN KEY ("tenant_id", "modifier_id") REFERENCES "modifier" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_line_modifier" ADD CONSTRAINT "fk_sale_line_modifier__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale_line_modifier" ADD CONSTRAINT "fk_sale_line_modifier__modifier" FOREIGN KEY ("tenant_id", "modifier_id") REFERENCES "modifier" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "fk_sale__bill" FOREIGN KEY ("tenant_id", "bill_id") REFERENCES "bill" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
-- 2. Partial helper index for handover/orphan reports
CREATE INDEX "ix_bill__handover_pending"
  ON "bill" ("tenant_id", "outlet_id", "handover_target_register_id")
  WHERE "status" = 'OPEN' AND "handover_status" = 'PENDING';
--> statement-breakpoint
-- 3. Guard triggers (SCHEMA §5.4 / §5.5, BR-FNB-012, BR-RCP-001, FR-DEV-006)
CREATE FUNCTION bill_lease_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.lease_device_id IS DISTINCT FROM OLD.lease_device_id
      OR NEW.lease_register_id IS DISTINCT FROM OLD.lease_register_id) THEN
    IF current_setting('app.bill_lease_change', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'bill_lease_immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bill_lease_guard_trg
  BEFORE UPDATE ON "bill"
  FOR EACH ROW EXECUTE FUNCTION bill_lease_guard();
--> statement-breakpoint
CREATE TRIGGER bill_event_immutable
  BEFORE UPDATE OR DELETE ON "bill_event"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER bill_event_no_truncate
  BEFORE TRUNCATE ON "bill_event"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE FUNCTION recipe_one_level() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM "recipe_item" r
      WHERE r."tenant_id" = NEW."tenant_id"
        AND r."deleted_at" IS NULL
        AND r."menu_sku_id" = NEW."ingredient_sku_id"
        AND r."id" <> NEW."id"
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'recipe_must_be_one_level: ingredient SKU already has its own recipe';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "recipe_item" r
      WHERE r."tenant_id" = NEW."tenant_id"
        AND r."deleted_at" IS NULL
        AND r."ingredient_sku_id" = NEW."menu_sku_id"
        AND r."id" <> NEW."id"
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'recipe_must_be_one_level: menu SKU is used as an ingredient in another recipe';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recipe_one_level_trg
  BEFORE INSERT OR UPDATE ON "recipe_item"
  FOR EACH ROW EXECUTE FUNCTION recipe_one_level();
--> statement-breakpoint
CREATE FUNCTION register_type_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.register_type IS DISTINCT FROM OLD.register_type THEN
    IF EXISTS (
      SELECT 1 FROM "cash_cashier" cc
      WHERE cc."tenant_id" = OLD."tenant_id"
        AND cc."register_id" = OLD."id"
        AND cc."status" = 'OPEN'
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'register_type_immutable: register has an OPEN shift';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "bill" b
      WHERE b."tenant_id" = OLD."tenant_id"
        AND (b."register_id" = OLD."id" OR b."lease_register_id" = OLD."id")
        AND b."status" = 'OPEN'
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'register_type_immutable: register has an OPEN bill';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER register_type_guard_trg
  BEFORE UPDATE OF "register_type" ON "cash_master"
  FOR EACH ROW EXECUTE FUNCTION register_type_guard();
--> statement-breakpoint
SELECT solva_enable_master_version_guard('modifier_group');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('modifier_group_product');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('modifier');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('fnb_table');
--> statement-breakpoint
-- 4. Enable + FORCE RLS on all F&B tables
SELECT solva_enable_tenant_rls('modifier_group');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('modifier_group_product');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('modifier');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('modifier_ingredient');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('recipe_item');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('fnb_table');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('bill');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('bill_item');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('bill_item_modifier');
--> statement-breakpoint
SELECT solva_enable_tenant_rls_append_only('bill_event');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('sale_line_modifier');
--> statement-breakpoint
-- 5. Least-privilege GRANT rules for solva_app (SCHEMA §5.5)
SELECT solva_grant_app('modifier_group', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('modifier_group_product', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('modifier', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('modifier_ingredient', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT solva_grant_app('recipe_item', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT solva_grant_app('fnb_table', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('bill', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (
  table_id, bill_ref, status, lease_device_id, lease_register_id,
  handover_status, handover_target_register_id, handover_event_id, handover_requested_at,
  prebill_seq, prebill_printed_at, last_content_seq,
  parent_bill_id, split_mode, share_index, share_count, merged_into_bill_id,
  bill_discount_type, bill_discount_pct, bill_discount_input, bill_discount_approved_by,
  customer_name, customer_phone, last_event_seq, last_event_at, closed_at
) ON "bill" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('bill_item', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (
  line_no, sku_id, uom_id, sku_code, item_name, uom_code,
  qty, conversion_factor, unit_price, price_source, is_open_price, taxable,
  discount_type, discount_pct, discount_input, discount_approved_by,
  note, status, void_reason_code, void_reason_text, origin_bill_id, origin_item_id
) ON "bill_item" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('bill_item_modifier', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (name, price_delta, qty) ON "bill_item_modifier" TO solva_app;
--> statement-breakpoint
REVOKE ALL ON "bill_event" FROM solva_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "bill_event" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('sale_line_modifier', 'SELECT, INSERT');
