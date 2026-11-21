-- Fase 54 (R-02): tampilan nilai persediaan per (outlet, SKU) termasuk in-transit masuk.
-- Saldo outlet (stock_balance) dan in-transit (v_in_transit, hanya transfer status SENT) digabung
-- lewat FULL JOIN agar in-transit tanpa baris saldo tetap tampil. Tidak menyimpan rata-rata (BR-HPP-002).
-- security_invoker = true: RLS tabel dasar tetap berlaku untuk pemanggil.
CREATE VIEW "v_stock_valuation" WITH (security_invoker = true) AS
  SELECT COALESCE(sb."tenant_id", it."tenant_id") AS "tenant_id",
         COALESCE(sb."outlet_id", it."outlet_id") AS "outlet_id",
         COALESCE(sb."sku_id", it."sku_id") AS "sku_id",
         COALESCE(sb."qty", 0) AS "qty",
         COALESCE(sb."inventory_value", 0) AS "inventory_value",
         (COALESCE(sb."qty", 0) < 0) AS "is_negative",
         COALESCE(it."qty_in_transit", 0) AS "qty_in_transit",
         COALESCE(it."value_in_transit", 0) AS "value_in_transit"
  FROM "stock_balance" sb
  FULL OUTER JOIN "v_in_transit" it
    ON it."tenant_id" = sb."tenant_id" AND it."outlet_id" = sb."outlet_id" AND it."sku_id" = sb."sku_id";
--> statement-breakpoint
GRANT SELECT ON "v_stock_valuation" TO solva_app;
