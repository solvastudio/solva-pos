CREATE TABLE "goods_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"status" text NOT NULL,
	"business_date" date NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"posted_at" timestamptz,
	"posted_by" uuid,
	"note" text,
	"doc_type" text DEFAULT 'RECEIPT' NOT NULL,
	"supplier_id" uuid,
	"reversal_of_id" uuid,
	"total_value" bigint DEFAULT 0 NOT NULL,
	"supplier_ref" text,
	CONSTRAINT "uq_goods_receipt__doc_no" UNIQUE("tenant_id","doc_no"),
	CONSTRAINT "ck_goods_receipt__doc_type" CHECK ("goods_receipt"."doc_type" IN ('RECEIPT', 'REVERSAL')),
	CONSTRAINT "ck_goods_receipt__status" CHECK ("goods_receipt"."status" IN ('DRAFT', 'POSTED')),
	CONSTRAINT "ck_goods_receipt__reversal_link" CHECK (("goods_receipt"."doc_type" = 'REVERSAL') = ("goods_receipt"."reversal_of_id" IS NOT NULL)),
	CONSTRAINT "ck_goods_receipt__reversal_posted" CHECK ("goods_receipt"."doc_type" <> 'REVERSAL' OR "goods_receipt"."status" = 'POSTED'),
	CONSTRAINT "ck_goods_receipt__total_value" CHECK ("goods_receipt"."total_value" >= 0),
	CONSTRAINT "ck_goods_receipt__supplier_ref_len" CHECK ("goods_receipt"."supplier_ref" IS NULL OR char_length("goods_receipt"."supplier_ref") <= 60)
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sku_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 4) NOT NULL,
	"qty_base" numeric(18, 4) NOT NULL,
	"unit_cost" bigint,
	"line_value" bigint NOT NULL,
	CONSTRAINT "uq_goods_receipt_line__line_no" UNIQUE("goods_receipt_id","line_no"),
	CONSTRAINT "ck_goods_receipt_line__qty" CHECK ("goods_receipt_line"."qty" > 0),
	CONSTRAINT "ck_goods_receipt_line__factor" CHECK ("goods_receipt_line"."conversion_factor" > 0),
	CONSTRAINT "ck_goods_receipt_line__qty_base" CHECK ("goods_receipt_line"."qty_base" > 0),
	CONSTRAINT "ck_goods_receipt_line__unit_cost" CHECK ("goods_receipt_line"."unit_cost" IS NULL OR "goods_receipt_line"."unit_cost" >= 0),
	CONSTRAINT "ck_goods_receipt_line__line_value" CHECK ("goods_receipt_line"."line_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_balance" (
	"outlet_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT 0 NOT NULL,
	"inventory_value" bigint DEFAULT 0 NOT NULL,
	"ref_value" bigint DEFAULT 0 NOT NULL,
	"ref_qty" numeric(18, 4) DEFAULT 0 NOT NULL,
	"rev" bigint DEFAULT 0 NOT NULL,
	"last_movement_at" timestamptz,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "pk_stock_balance" PRIMARY KEY("outlet_id","sku_id"),
	CONSTRAINT "ck_stock_balance__ref_qty" CHECK ("stock_balance"."ref_qty" >= 0),
	CONSTRAINT "ck_stock_balance__qty_scale" CHECK ("stock_balance"."qty" = trunc("stock_balance"."qty", 4)),
	CONSTRAINT "ck_stock_balance__zero_value" CHECK ("stock_balance"."qty" <> 0 OR "stock_balance"."inventory_value" = 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"processed_at" timestamptz DEFAULT now() NOT NULL,
	"occurred_at" timestamptz NOT NULL,
	"business_date" date NOT NULL,
	"sku_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"qty_delta" numeric(18, 4) NOT NULL,
	"value_delta" bigint NOT NULL,
	"qty_after" numeric(18, 4) NOT NULL,
	"value_after" bigint NOT NULL,
	"bal_seq" bigint NOT NULL,
	"cost_basis" text NOT NULL,
	"is_negative_result" boolean DEFAULT false NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reverses_movement_id" uuid,
	"command_id" uuid,
	"created_by" uuid,
	CONSTRAINT "uq_stock_movement__source" UNIQUE("tenant_id","source_type","source_id","sku_id","movement_type"),
	CONSTRAINT "uq_stock_movement__bal_seq" UNIQUE("outlet_id","sku_id","bal_seq"),
	CONSTRAINT "ck_stock_movement__movement_type" CHECK ("stock_movement"."movement_type" IN ('SALE', 'SALE_VOID', 'RETURN_IN', 'GR_IN', 'GR_REVERSAL', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'RECIPE_CONSUMPTION')),
	CONSTRAINT "ck_stock_movement__cost_basis" CHECK ("stock_movement"."cost_basis" IN ('AVERAGE', 'REFERENCE', 'MIXED', 'SNAPSHOT', 'TRANSFER', 'DECLARED')),
	CONSTRAINT "ck_stock_movement__source_type" CHECK ("stock_movement"."source_type" IN ('SALE_LINE', 'CREDIT_NOTE_LINE', 'GR_LINE', 'TRANSFER_LINE', 'STOCKTAKE_LINE')),
	CONSTRAINT "ck_stock_movement__qty_delta" CHECK ("stock_movement"."qty_delta" <> 0 AND "stock_movement"."qty_delta" = trunc("stock_movement"."qty_delta", 4)),
	CONSTRAINT "ck_stock_movement__sign" CHECK (("stock_movement"."qty_delta" > 0 AND "stock_movement"."value_delta" >= 0) OR ("stock_movement"."qty_delta" < 0 AND "stock_movement"."value_delta" <= 0) OR "stock_movement"."value_delta" = 0),
	CONSTRAINT "ck_stock_movement__zero_value_after" CHECK ("stock_movement"."qty_after" <> 0 OR "stock_movement"."value_after" = 0)
);
--> statement-breakpoint
CREATE TABLE "stocktake" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"status" text NOT NULL,
	"business_date" date NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"posted_at" timestamptz,
	"posted_by" uuid,
	"note" text,
	"scope" text DEFAULT 'SELECTED' NOT NULL,
	"snapshot_at" timestamptz NOT NULL,
	CONSTRAINT "uq_stocktake__doc_no" UNIQUE("tenant_id","doc_no"),
	CONSTRAINT "ck_stocktake__status" CHECK ("stocktake"."status" IN ('DRAFT', 'POSTED', 'CANCELED')),
	CONSTRAINT "ck_stocktake__scope" CHECK ("stocktake"."scope" IN ('ALL', 'SELECTED'))
);
--> statement-breakpoint
CREATE TABLE "stocktake_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"snapshot_qty" numeric(18, 4) NOT NULL,
	"counted_qty" numeric(18, 4),
	"delta_qty" numeric(18, 4) GENERATED ALWAYS AS (counted_qty - snapshot_qty) STORED,
	"delta_value" bigint,
	CONSTRAINT "uq_stocktake_line__sku" UNIQUE("stocktake_id","sku_id"),
	CONSTRAINT "ck_stocktake_line__counted" CHECK ("stocktake_line"."counted_qty" IS NULL OR "stocktake_line"."counted_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"name" text NOT NULL,
	"contact" text,
	CONSTRAINT "ck_supplier__name_len" CHECK (char_length("supplier"."name") BETWEEN 1 AND 120),
	CONSTRAINT "ck_supplier__contact_len" CHECK ("supplier"."contact" IS NULL OR char_length("supplier"."contact") <= 200)
);
--> statement-breakpoint
CREATE TABLE "transfer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"status" text NOT NULL,
	"business_date" date NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"posted_at" timestamptz,
	"posted_by" uuid,
	"note" text,
	"to_outlet_id" uuid NOT NULL,
	"sent_at" timestamptz,
	"sent_by" uuid,
	"received_at" timestamptz,
	"received_by" uuid,
	"close_reason_code" text,
	"close_reason_text" text,
	CONSTRAINT "uq_transfer__doc_no" UNIQUE("tenant_id","doc_no"),
	CONSTRAINT "ck_transfer__outlets" CHECK ("transfer"."to_outlet_id" <> "transfer"."outlet_id"),
	CONSTRAINT "ck_transfer__status" CHECK ("transfer"."status" IN ('DRAFT', 'SENT', 'RECEIVED', 'CANCELED')),
	CONSTRAINT "ck_transfer__sent" CHECK ("transfer"."status" <> 'SENT' OR ("transfer"."sent_at" IS NOT NULL AND "transfer"."sent_by" IS NOT NULL)),
	CONSTRAINT "ck_transfer__received" CHECK ("transfer"."status" <> 'RECEIVED' OR "transfer"."received_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "transfer_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sku_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty_input" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 4) NOT NULL,
	"qty_sent_base" numeric(18, 4) NOT NULL,
	"value_sent" bigint,
	"qty_received_base" numeric(18, 4),
	"value_received" bigint,
	"qty_variance_base" numeric(18, 4),
	"value_variance" bigint,
	CONSTRAINT "uq_transfer_line__line_no" UNIQUE("transfer_id","line_no"),
	CONSTRAINT "ck_transfer_line__qty_input" CHECK ("transfer_line"."qty_input" > 0),
	CONSTRAINT "ck_transfer_line__factor" CHECK ("transfer_line"."conversion_factor" > 0),
	CONSTRAINT "ck_transfer_line__qty_sent" CHECK ("transfer_line"."qty_sent_base" > 0),
	CONSTRAINT "ck_transfer_line__qty_received" CHECK ("transfer_line"."qty_received_base" IS NULL OR ("transfer_line"."qty_received_base" BETWEEN 0 AND "transfer_line"."qty_sent_base"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipt__reversal_of" ON "goods_receipt" USING btree ("reversal_of_id") WHERE "goods_receipt"."reversal_of_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_stock_balance__negative" ON "stock_balance" USING btree ("tenant_id","outlet_id") WHERE "stock_balance"."qty" < 0;--> statement-breakpoint
CREATE INDEX "ix_stock_movement__sku_seq" ON "stock_movement" USING btree ("tenant_id","outlet_id","sku_id","bal_seq");--> statement-breakpoint
CREATE INDEX "ix_stock_movement__business_date" ON "stock_movement" USING btree ("tenant_id","outlet_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier__tenant_name" ON "supplier" USING btree ("tenant_id",lower("name")) WHERE "supplier"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_transfer__in_transit" ON "transfer" USING btree ("tenant_id","to_outlet_id") WHERE "transfer"."status" = 'SENT';