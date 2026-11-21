-- 1. Kunci unik komposit (tenant_id, id) sebagai target FK komposit (SCHEMA §5.4)
CREATE UNIQUE INDEX "uq_stock_movement__tenant_id_id" ON "stock_movement" ("tenant_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier__tenant_id_id" ON "supplier" ("tenant_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipt__tenant_id_id" ON "goods_receipt" ("tenant_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_transfer__tenant_id_id" ON "transfer" ("tenant_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stocktake__tenant_id_id" ON "stocktake" ("tenant_id", "id");
--> statement-breakpoint
-- 2. FK tenant dan lintas modul (komposit tenant, pola Fase 30/40)
ALTER TABLE "stock_balance" ADD CONSTRAINT "fk_stock_balance__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "fk_stock_balance__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "fk_stock_balance__sku" FOREIGN KEY ("tenant_id", "sku_id") REFERENCES "sku" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "fk_stock_movement__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "fk_stock_movement__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "fk_stock_movement__sku" FOREIGN KEY ("tenant_id", "sku_id") REFERENCES "sku" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "fk_stock_movement__reverses" FOREIGN KEY ("tenant_id", "reverses_movement_id") REFERENCES "stock_movement" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "fk_stock_movement__command" FOREIGN KEY ("tenant_id", "command_id") REFERENCES "idempotency_command" ("tenant_id", "command_id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "fk_stock_movement__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "fk_supplier__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "fk_supplier__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "fk_supplier__updated_by" FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "fk_goods_receipt__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "fk_goods_receipt__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "fk_goods_receipt__supplier" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "fk_goods_receipt__reversal_of" FOREIGN KEY ("tenant_id", "reversal_of_id") REFERENCES "goods_receipt" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "fk_goods_receipt__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "fk_goods_receipt__posted_by" FOREIGN KEY ("tenant_id", "posted_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "fk_goods_receipt_line__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "fk_goods_receipt_line__receipt" FOREIGN KEY ("tenant_id", "goods_receipt_id") REFERENCES "goods_receipt" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "fk_goods_receipt_line__sku" FOREIGN KEY ("tenant_id", "sku_id") REFERENCES "sku" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "fk_goods_receipt_line__sku_uom" FOREIGN KEY ("sku_id", "uom_id") REFERENCES "sku_uom" ("sku_id", "uom_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "fk_transfer__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "fk_transfer__from_outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "fk_transfer__to_outlet" FOREIGN KEY ("tenant_id", "to_outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "fk_transfer__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "fk_transfer__sent_by" FOREIGN KEY ("tenant_id", "sent_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "fk_transfer__received_by" FOREIGN KEY ("tenant_id", "received_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "fk_transfer_line__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "fk_transfer_line__transfer" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "transfer" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "fk_transfer_line__sku" FOREIGN KEY ("tenant_id", "sku_id") REFERENCES "sku" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "fk_transfer_line__sku_uom" FOREIGN KEY ("sku_id", "uom_id") REFERENCES "sku_uom" ("sku_id", "uom_id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stocktake" ADD CONSTRAINT "fk_stocktake__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stocktake" ADD CONSTRAINT "fk_stocktake__outlet" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stocktake" ADD CONSTRAINT "fk_stocktake__created_by" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stocktake" ADD CONSTRAINT "fk_stocktake__posted_by" FOREIGN KEY ("tenant_id", "posted_by") REFERENCES "app_user" ("tenant_id", "id") MATCH SIMPLE ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stocktake_line" ADD CONSTRAINT "fk_stocktake_line__tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stocktake_line" ADD CONSTRAINT "fk_stocktake_line__stocktake" FOREIGN KEY ("tenant_id", "stocktake_id") REFERENCES "stocktake" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "stocktake_line" ADD CONSTRAINT "fk_stocktake_line__sku" FOREIGN KEY ("tenant_id", "sku_id") REFERENCES "sku" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
-- 3. RLS: tenant standar; stock_movement append-only (SELECT dan INSERT saja)
SELECT solva_enable_tenant_rls('stock_balance');
--> statement-breakpoint
SELECT solva_enable_tenant_rls_append_only('stock_movement');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('supplier');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('goods_receipt');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('goods_receipt_line');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('transfer');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('transfer_line');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('stocktake');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('stocktake_line');
--> statement-breakpoint
-- 4. Immutability berlapis untuk ledger (pemilik tabel pun gagal UPDATE/DELETE/TRUNCATE)
CREATE TRIGGER stock_movement_immutable
  BEFORE UPDATE OR DELETE ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER stock_movement_no_truncate
  BEFORE TRUNCATE ON "stock_movement"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- 5. Hak akses solva_app: ledger tanpa UPDATE/DELETE; dokumen hanya kolom yang sah
REVOKE ALL ON "stock_movement" FROM solva_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "stock_movement" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('stock_balance', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('supplier', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('goods_receipt', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (status, posted_at, posted_by, total_value, supplier_ref, supplier_id, note, updated_at) ON "goods_receipt" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('goods_receipt_line', 'SELECT, INSERT');
--> statement-breakpoint
SELECT solva_grant_app('transfer', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (status, sent_at, sent_by, received_at, received_by, close_reason_code, close_reason_text, note, updated_at) ON "transfer" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('transfer_line', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (value_sent, qty_received_base, value_received, qty_variance_base, value_variance) ON "transfer_line" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('stocktake', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (status, posted_at, posted_by, note, updated_at) ON "stocktake" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('stocktake_line', 'SELECT, INSERT');
--> statement-breakpoint
GRANT UPDATE (counted_qty, delta_value) ON "stocktake_line" TO solva_app;
--> statement-breakpoint
-- 6. Perluas penjagaan base UOM: produk yang sudah punya movement stok tidak boleh ganti base_uom_id
CREATE OR REPLACE FUNCTION product_base_uom_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_uom_id IS DISTINCT FROM OLD.base_uom_id THEN
    IF EXISTS (SELECT 1 FROM "sale_line" WHERE "tenant_id" = OLD.tenant_id AND "product_id" = OLD.id LIMIT 1) THEN
      RAISE EXCEPTION 'product.base_uom_id cannot be changed after transactions exist';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "stock_movement" sm
      JOIN "sku" s ON s."tenant_id" = sm."tenant_id" AND s."id" = sm."sku_id"
      WHERE sm."tenant_id" = OLD.tenant_id AND s."product_id" = OLD.id
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'product.base_uom_id cannot be changed after stock movements exist';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 7. View dasar in-transit (BR-TRF-002): memakai hak pemanggil sehingga RLS berlaku
CREATE VIEW "v_in_transit" WITH (security_invoker = true) AS
  SELECT t."tenant_id", t."to_outlet_id" AS "outlet_id", tl."sku_id",
         sum(tl."qty_sent_base") AS "qty_in_transit",
         sum(tl."value_sent") AS "value_in_transit"
  FROM "transfer" t
  JOIN "transfer_line" tl ON tl."tenant_id" = t."tenant_id" AND tl."transfer_id" = t."id"
  WHERE t."status" = 'SENT'
  GROUP BY t."tenant_id", t."to_outlet_id", tl."sku_id";
--> statement-breakpoint
GRANT SELECT ON "v_in_transit" TO solva_app;
