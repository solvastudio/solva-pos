-- 1. Cross-module & self-referential composite FKs
ALTER TABLE "category" ADD CONSTRAINT "fk_category__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "fk_category__parent" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "category" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "fk_category__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "fk_category__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "uom" ADD CONSTRAINT "fk_uom__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "uom" ADD CONSTRAINT "fk_uom__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "uom" ADD CONSTRAINT "fk_uom__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
-- Note: immutability trigger preventing product.base_uom_id changes after stock_movement/sale_line exist will be added in Phase 40/52.
ALTER TABLE "product" ADD CONSTRAINT "fk_product__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "fk_product__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "fk_product__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "product_attribute" ADD CONSTRAINT "fk_product_attribute__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "product_attribute" ADD CONSTRAINT "fk_product_attribute__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "product_attribute" ADD CONSTRAINT "fk_product_attribute__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "attribute_value" ADD CONSTRAINT "fk_attribute_value__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "attribute_value" ADD CONSTRAINT "fk_attribute_value__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "attribute_value" ADD CONSTRAINT "fk_attribute_value__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku" ADD CONSTRAINT "fk_sku__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku" ADD CONSTRAINT "fk_sku__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku" ADD CONSTRAINT "fk_sku__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku_attribute_value" ADD CONSTRAINT "fk_sku_attribute_value__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku_attribute_value" ADD CONSTRAINT "fk_sku_attribute_value__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku_attribute_value" ADD CONSTRAINT "fk_sku_attribute_value__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku_uom" ADD CONSTRAINT "fk_sku_uom__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku_uom" ADD CONSTRAINT "fk_sku_uom__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sku_uom" ADD CONSTRAINT "fk_sku_uom__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "item_outlet_availability" ADD CONSTRAINT "fk_item_outlet_avail__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "item_outlet_availability" ADD CONSTRAINT "fk_item_outlet_avail__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "item_outlet_availability" ADD CONSTRAINT "fk_item_outlet_avail__sku_product" FOREIGN KEY ("sku_id", "product_id") REFERENCES "sku" ("id", "product_id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "item_outlet_availability" ADD CONSTRAINT "fk_item_outlet_avail__tenant_sku" FOREIGN KEY ("tenant_id", "sku_id") REFERENCES "sku" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "item_outlet_availability" ADD CONSTRAINT "fk_item_outlet_avail__changed_by" FOREIGN KEY ("tenant_id", "changed_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "item_outlet_availability" ADD CONSTRAINT "fk_item_outlet_avail__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "item_outlet_availability" ADD CONSTRAINT "fk_item_outlet_avail__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "price_entry" ADD CONSTRAINT "fk_price_entry__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "price_entry" ADD CONSTRAINT "fk_price_entry__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "price_entry" ADD CONSTRAINT "fk_price_entry__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "price_entry" ADD CONSTRAINT "fk_price_entry__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "fk_feature_flag__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "fk_feature_flag__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
-- 2. Partial/expression/NULLS NOT DISTINCT unique constraints & search index
CREATE UNIQUE INDEX "uq_category__tenant_parent_name"
  ON "category" ("tenant_id", "parent_id", lower("name")) NULLS NOT DISTINCT
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_uom__tenant_code"
  ON "uom" ("tenant_id", lower("code"))
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "ix_product__tenant_name"
  ON "product" ("tenant_id", lower("name") text_pattern_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_attribute__product_name"
  ON "product_attribute" ("product_id", lower("name"))
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attribute_value__attr_value"
  ON "attribute_value" ("attribute_id", lower("value"))
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "item_outlet_availability"
  ADD CONSTRAINT "uq_item_outlet_avail__outlet_prod_sku"
  UNIQUE NULLS NOT DISTINCT ("outlet_id", "product_id", "sku_id");
--> statement-breakpoint
ALTER TABLE "price_entry"
  ADD CONSTRAINT "uq_price_entry__key"
  UNIQUE NULLS NOT DISTINCT ("tenant_id", "sku_id", "uom_id", "outlet_id");
--> statement-breakpoint
-- 3. Business-rule triggers (one function per rule)
CREATE FUNCTION category_max_two_levels() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_parent_parent_id uuid;
  v_has_child boolean;
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.parent_id IS NOT NULL THEN
    SELECT c.parent_id INTO v_parent_parent_id
    FROM category c
    WHERE c.tenant_id = NEW.tenant_id
      AND c.id = NEW.parent_id;

    IF v_parent_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'category depth > 2';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM category child
      WHERE child.tenant_id = NEW.tenant_id
        AND child.parent_id = NEW.id
        AND child.deleted_at IS NULL
    ) INTO v_has_child;

    IF v_has_child THEN
      RAISE EXCEPTION 'category depth > 2 (category already has child categories)';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER category_max_two_levels_trg
  BEFORE INSERT OR UPDATE OF parent_id, deleted_at ON "category"
  FOR EACH ROW EXECUTE FUNCTION category_max_two_levels();
--> statement-breakpoint
CREATE FUNCTION product_attribute_max_three() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.deleted_at IS NULL THEN
    SELECT count(*) INTO v_count
    FROM product_attribute pa
    WHERE pa.product_id = NEW.product_id
      AND pa.deleted_at IS NULL
      AND pa.id <> NEW.id;

    IF v_count >= 3 THEN
      RAISE EXCEPTION 'product cannot have more than 3 active attributes';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_attribute_max_three_trg
  BEFORE INSERT OR UPDATE OF product_id, deleted_at ON "product_attribute"
  FOR EACH ROW EXECUTE FUNCTION product_attribute_max_three();
--> statement-breakpoint
CREATE FUNCTION sku_max_active_per_product() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.is_active = true AND NEW.deleted_at IS NULL THEN
    SELECT count(*) INTO v_count
    FROM sku s
    WHERE s.product_id = NEW.product_id
      AND s.is_active = true
      AND s.deleted_at IS NULL
      AND s.id <> NEW.id;

    IF v_count >= 100 THEN
      RAISE EXCEPTION 'product cannot have more than 100 active SKUs';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sku_max_active_per_product_trg
  BEFORE INSERT OR UPDATE OF product_id, is_active, deleted_at ON "sku"
  FOR EACH ROW EXECUTE FUNCTION sku_max_active_per_product();
--> statement-breakpoint
CREATE FUNCTION sku_default_exactly_one() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_pid uuid;
  v_has_variants boolean;
  v_prod_deleted timestamptz;
  v_default_count integer;
BEGIN
  FOR v_pid IN
    SELECT DISTINCT pid
    FROM (VALUES (NEW.product_id), (OLD.product_id)) AS p(pid)
    WHERE pid IS NOT NULL
  LOOP
    SELECT p.has_variants, p.deleted_at
    INTO v_has_variants, v_prod_deleted
    FROM product p
    WHERE p.id = v_pid;

    IF v_has_variants IS NULL OR v_prod_deleted IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_default_count
    FROM sku s
    WHERE s.product_id = v_pid
      AND s.is_default = true
      AND s.deleted_at IS NULL;

    IF v_has_variants = false AND v_default_count <> 1 THEN
      RAISE EXCEPTION 'single-variant product % must have exactly 1 active default SKU (found %)', v_pid, v_default_count;
    END IF;

    IF v_has_variants = true AND v_default_count <> 0 THEN
      RAISE EXCEPTION 'multi-variant product % must not have a default SKU (found %)', v_pid, v_default_count;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sku_default_exactly_one_trg
  AFTER INSERT OR UPDATE OF product_id, is_default, deleted_at OR DELETE ON "sku"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sku_default_exactly_one();
--> statement-breakpoint
CREATE FUNCTION sku_uom_base_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_base_uom_id uuid;
BEGIN
  IF NEW.deleted_at IS NULL THEN
    SELECT p.base_uom_id INTO v_base_uom_id
    FROM sku s
    JOIN product p ON p.tenant_id = s.tenant_id AND p.id = s.product_id
    WHERE s.tenant_id = NEW.tenant_id
      AND s.id = NEW.sku_id;

    IF v_base_uom_id IS NULL THEN
      RAISE EXCEPTION 'parent product not found for sku %', NEW.sku_id;
    END IF;

    IF NEW.is_base THEN
      IF NEW.uom_id IS DISTINCT FROM v_base_uom_id OR NEW.conversion_factor <> 1 THEN
        RAISE EXCEPTION 'base sku_uom must use product base_uom_id with conversion_factor = 1';
      END IF;
    ELSE
      IF NEW.uom_id = v_base_uom_id THEN
        RAISE EXCEPTION 'non-base sku_uom cannot use product base_uom_id';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sku_uom_base_consistency_trg
  BEFORE INSERT OR UPDATE OF sku_id, uom_id, is_base, conversion_factor, deleted_at ON "sku_uom"
  FOR EACH ROW EXECUTE FUNCTION sku_uom_base_consistency();
--> statement-breakpoint
CREATE FUNCTION sku_attribute_value_one_per_attribute() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_attribute_id uuid;
  v_exists boolean;
BEGIN
  IF NEW.deleted_at IS NULL THEN
    SELECT av.attribute_id INTO v_attribute_id
    FROM attribute_value av
    WHERE av.tenant_id = NEW.tenant_id
      AND av.id = NEW.attribute_value_id;

    SELECT EXISTS (
      SELECT 1
      FROM sku_attribute_value sav
      JOIN attribute_value av
        ON av.tenant_id = sav.tenant_id
       AND av.id = sav.attribute_value_id
      WHERE sav.sku_id = NEW.sku_id
        AND sav.deleted_at IS NULL
        AND sav.id <> NEW.id
        AND av.attribute_id = v_attribute_id
    ) INTO v_exists;

    IF v_exists THEN
      RAISE EXCEPTION 'SKU % already has a value assigned for attribute %', NEW.sku_id, v_attribute_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sku_attribute_value_one_per_attribute_trg
  BEFORE INSERT OR UPDATE OF sku_id, attribute_value_id, deleted_at ON "sku_attribute_value"
  FOR EACH ROW EXECUTE FUNCTION sku_attribute_value_one_per_attribute();
--> statement-breakpoint
-- 4. Master version guard on all Class M tables
SELECT solva_enable_master_version_guard('category');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('uom');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('product');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('sku');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('sku_uom');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('item_outlet_availability');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('price_entry');
--> statement-breakpoint
SELECT solva_enable_master_version_guard('feature_flag');
--> statement-breakpoint
-- 5. Enable + FORCE Row Level Security on all 11 tables
SELECT solva_enable_tenant_rls('category');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('uom');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('product');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('product_attribute');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('attribute_value');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('sku');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('sku_attribute_value');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('sku_uom');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('item_outlet_availability');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('price_entry');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('feature_flag');
--> statement-breakpoint
-- 6. Grants for solva_app (Class M tombstone-only except item_outlet_availability; Class S allows DELETE)
SELECT solva_grant_app('category', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('uom', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('product', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('product_attribute', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT solva_grant_app('attribute_value', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT solva_grant_app('sku', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('sku_attribute_value', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT solva_grant_app('sku_uom', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('item_outlet_availability', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT solva_grant_app('price_entry', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('feature_flag', 'SELECT, INSERT, UPDATE');
