CREATE TABLE "modifier" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"modifier_group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_modifier__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_modifier__version" CHECK ("modifier"."version" > 0),
	CONSTRAINT "ck_modifier__name_len" CHECK (char_length("modifier"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "modifier_group" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"name" text NOT NULL,
	"selection_type" text DEFAULT 'MULTI' NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_modifier_group__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_modifier_group__version" CHECK ("modifier_group"."version" > 0),
	CONSTRAINT "ck_modifier_group__name_len" CHECK (char_length("modifier_group"."name") BETWEEN 1 AND 60),
	CONSTRAINT "ck_modifier_group__selection_type" CHECK (selection_type IN ('SINGLE', 'MULTI')),
	CONSTRAINT "ck_modifier_group__min_select" CHECK ("modifier_group"."min_select" >= 0),
	CONSTRAINT "ck_modifier_group__max_select" CHECK ("modifier_group"."max_select" IS NULL OR "modifier_group"."max_select" >= "modifier_group"."min_select")
);
--> statement-breakpoint
CREATE TABLE "modifier_group_product" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"modifier_group_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_modifier_group_product__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_modifier_group_product__pair" UNIQUE("modifier_group_id","product_id"),
	CONSTRAINT "ck_modifier_group_product__version" CHECK ("modifier_group_product"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "modifier_ingredient" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"modifier_id" uuid NOT NULL,
	"ingredient_sku_id" uuid NOT NULL,
	"adjust_type" text NOT NULL,
	"qty" numeric(18, 4),
	CONSTRAINT "uq_modifier_ingredient__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_modifier_ingredient__adjust_type" CHECK (adjust_type IN ('ADD', 'REDUCE', 'REMOVE')),
	CONSTRAINT "ck_modifier_ingredient__adjust_qty" CHECK (("modifier_ingredient"."adjust_type" = 'REMOVE' AND "modifier_ingredient"."qty" IS NULL) OR ("modifier_ingredient"."adjust_type" IN ('ADD', 'REDUCE') AND "modifier_ingredient"."qty" IS NOT NULL AND "modifier_ingredient"."qty" > 0))
);
--> statement-breakpoint
CREATE TABLE "recipe_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"menu_sku_id" uuid NOT NULL,
	"ingredient_sku_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	CONSTRAINT "uq_recipe_item__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_recipe_item__qty_pos" CHECK ("recipe_item"."qty" > 0),
	CONSTRAINT "ck_recipe_item__distinct_skus" CHECK ("recipe_item"."menu_sku_id" <> "recipe_item"."ingredient_sku_id")
);
--> statement-breakpoint
CREATE TABLE "bill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at_device" timestamptz NOT NULL,
	"clock_offset_ms" integer NOT NULL,
	"occurred_at" timestamptz NOT NULL,
	"business_date" date NOT NULL,
	"received_at" timestamptz DEFAULT now() NOT NULL,
	"command_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"app_version" text,
	"table_id" uuid NOT NULL,
	"bill_ref" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"lease_device_id" uuid NOT NULL,
	"lease_register_id" uuid NOT NULL,
	"handover_status" text DEFAULT 'NONE' NOT NULL,
	"handover_target_register_id" uuid,
	"handover_event_id" uuid,
	"handover_requested_at" timestamptz,
	"prebill_seq" integer,
	"prebill_printed_at" timestamptz,
	"last_content_seq" integer DEFAULT 0 NOT NULL,
	"is_awaiting_payment" boolean GENERATED ALWAYS AS (prebill_seq IS NOT NULL AND prebill_seq > last_content_seq) STORED,
	"parent_bill_id" uuid,
	"split_mode" text,
	"share_index" smallint,
	"share_count" smallint,
	"merged_into_bill_id" uuid,
	"bill_discount_type" text,
	"bill_discount_pct" numeric(7, 4),
	"bill_discount_input" bigint,
	"bill_discount_approved_by" uuid,
	"customer_name" text,
	"customer_phone" text,
	"last_event_seq" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamptz,
	"closed_at" timestamptz,
	CONSTRAINT "uq_bill__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_bill__ref_len" CHECK (char_length("bill"."bill_ref") BETWEEN 1 AND 30),
	CONSTRAINT "ck_bill__status" CHECK (status IN ('OPEN', 'SPLIT', 'PAID', 'CANCELED', 'MERGED', 'CLOSED_BY_SPLIT')),
	CONSTRAINT "ck_bill__handover_status" CHECK (handover_status IN ('NONE', 'PENDING')),
	CONSTRAINT "ck_bill__handover_pending_fields" CHECK (("bill"."handover_status" = 'PENDING') = ("bill"."handover_target_register_id" IS NOT NULL AND "bill"."handover_event_id" IS NOT NULL)),
	CONSTRAINT "ck_bill__handover_only_open" CHECK ("bill"."handover_status" = 'NONE' OR "bill"."status" = 'OPEN'),
	CONSTRAINT "ck_bill__merged_target" CHECK ("bill"."status" <> 'MERGED' OR "bill"."merged_into_bill_id" IS NOT NULL),
	CONSTRAINT "ck_bill__not_self_parent" CHECK ("bill"."parent_bill_id" IS NULL OR "bill"."parent_bill_id" <> "bill"."id"),
	CONSTRAINT "ck_bill__split_mode" CHECK (split_mode IS NULL OR split_mode IN ('ITEM', 'QTY', 'EQUAL')),
	CONSTRAINT "ck_bill__equal_share_fields" CHECK (("bill"."split_mode" IS NOT DISTINCT FROM 'EQUAL') = ("bill"."share_index" IS NOT NULL AND "bill"."share_count" IS NOT NULL)),
	CONSTRAINT "ck_bill__share_bounds" CHECK ("bill"."share_index" IS NULL OR ("bill"."share_index" >= 1 AND "bill"."share_index" <= "bill"."share_count")),
	CONSTRAINT "ck_bill__discount_type" CHECK (bill_discount_type IS NULL OR bill_discount_type IN ('PERCENT', 'NOMINAL')),
	CONSTRAINT "ck_bill__discount_pct" CHECK ("bill"."bill_discount_pct" IS NULL OR ("bill"."bill_discount_pct" >= 0 AND "bill"."bill_discount_pct" <= 100)),
	CONSTRAINT "ck_bill__discount_input" CHECK ("bill"."bill_discount_input" IS NULL OR "bill"."bill_discount_input" >= 0),
	CONSTRAINT "ck_bill__last_event_seq" CHECK ("bill"."last_event_seq" >= 0),
	CONSTRAINT "ck_bill__last_content_seq" CHECK ("bill"."last_content_seq" >= 0),
	CONSTRAINT "ck_bill__schema_version" CHECK ("bill"."schema_version" > 0),
	CONSTRAINT "ck_bill__app_version" CHECK (app_version IS NULL OR (char_length(app_version) <= 30 AND app_version ~ '^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$'))
);
--> statement-breakpoint
CREATE TABLE "bill_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"bill_seq" integer NOT NULL,
	"device_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"device_seq" bigint NOT NULL,
	"staff_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reason_code" text,
	"reason_text" text,
	"origin_bill_id" uuid,
	"origin_event_ids" uuid[],
	"target_register_id" uuid,
	"handover_event_id" uuid,
	"created_at_device" timestamptz NOT NULL,
	"clock_offset_ms" integer NOT NULL,
	"occurred_at" timestamptz NOT NULL,
	"business_date" text NOT NULL,
	"received_at" timestamptz DEFAULT now() NOT NULL,
	"command_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"app_version" text,
	CONSTRAINT "uq_bill_event__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_bill_event__bill_seq" UNIQUE("bill_id","bill_seq"),
	CONSTRAINT "uq_bill_event__device_seq" UNIQUE("device_id","device_seq"),
	CONSTRAINT "ck_bill_event__bill_seq" CHECK ("bill_event"."bill_seq" > 0),
	CONSTRAINT "ck_bill_event__device_seq" CHECK ("bill_event"."device_seq" > 0),
	CONSTRAINT "ck_bill_event__event_type" CHECK (event_type IN ('BILL_OPENED', 'ITEM_ADDED', 'ITEM_VOIDED', 'ITEM_QTY_CHANGED', 'MODIFIER_SET', 'CUSTOMER_SET', 'TABLE_SET', 'BILL_CANCELED', 'PREBILL_PRINTED', 'BILL_HANDED_OVER', 'BILL_ACCEPTED', 'BILL_HANDOVER_CANCELED', 'DISCOUNT_SET', 'BILL_SPLIT', 'BILL_MERGED')),
	CONSTRAINT "ck_bill_event__schema_version" CHECK ("bill_event"."schema_version" > 0),
	CONSTRAINT "ck_bill_event__app_version" CHECK (app_version IS NULL OR (char_length(app_version) <= 30 AND app_version ~ '^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$'))
);
--> statement-breakpoint
CREATE TABLE "bill_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sku_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"sku_code" text NOT NULL,
	"item_name" text NOT NULL,
	"uom_code" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 4) NOT NULL,
	"unit_price" bigint NOT NULL,
	"price_source" text NOT NULL,
	"is_open_price" boolean DEFAULT false NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"discount_type" text,
	"discount_pct" numeric(7, 4),
	"discount_input" bigint,
	"discount_approved_by" uuid,
	"note" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"void_reason_code" text,
	"void_reason_text" text,
	"origin_bill_id" uuid,
	"origin_item_id" uuid,
	"created_event_id" uuid NOT NULL,
	CONSTRAINT "uq_bill_item__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_bill_item__bill_line_no" UNIQUE("bill_id","line_no"),
	CONSTRAINT "ck_bill_item__line_no" CHECK ("bill_item"."line_no" > 0),
	CONSTRAINT "ck_bill_item__item_name_len" CHECK (char_length("bill_item"."item_name") <= 200),
	CONSTRAINT "ck_bill_item__qty" CHECK ("bill_item"."qty" > 0),
	CONSTRAINT "ck_bill_item__conversion_factor" CHECK ("bill_item"."conversion_factor" > 0),
	CONSTRAINT "ck_bill_item__unit_price" CHECK ("bill_item"."unit_price" >= 0),
	CONSTRAINT "ck_bill_item__price_source" CHECK (price_source IN ('OUTLET', 'TENANT_DEFAULT', 'OPEN_PRICE')),
	CONSTRAINT "ck_bill_item__discount_type" CHECK (discount_type IS NULL OR discount_type IN ('PERCENT', 'NOMINAL')),
	CONSTRAINT "ck_bill_item__discount_pct" CHECK ("bill_item"."discount_pct" IS NULL OR ("bill_item"."discount_pct" >= 0 AND "bill_item"."discount_pct" <= 100)),
	CONSTRAINT "ck_bill_item__discount_input" CHECK ("bill_item"."discount_input" IS NULL OR "bill_item"."discount_input" >= 0),
	CONSTRAINT "ck_bill_item__discount_null_pair" CHECK (("bill_item"."discount_type" IS NULL) = ("bill_item"."discount_pct" IS NULL AND "bill_item"."discount_input" IS NULL)),
	CONSTRAINT "ck_bill_item__note_len" CHECK ("bill_item"."note" IS NULL OR char_length("bill_item"."note") <= 200),
	CONSTRAINT "ck_bill_item__status" CHECK (status IN ('ACTIVE', 'VOIDED', 'MOVED')),
	CONSTRAINT "ck_bill_item__void_reason" CHECK ("bill_item"."status" <> 'VOIDED' OR "bill_item"."void_reason_text" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "bill_item_modifier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bill_item_id" uuid NOT NULL,
	"modifier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta" bigint NOT NULL,
	"qty" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "uq_bill_item_modifier__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_bill_item_modifier__item_mod" UNIQUE("bill_item_id","modifier_id"),
	CONSTRAINT "ck_bill_item_modifier__name_len" CHECK (char_length("bill_item_modifier"."name") BETWEEN 1 AND 60),
	CONSTRAINT "ck_bill_item_modifier__qty" CHECK ("bill_item_modifier"."qty" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fnb_table" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"outlet_id" uuid NOT NULL,
	"code" text NOT NULL,
	"area" text,
	"capacity" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_fnb_table__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_fnb_table__version" CHECK ("fnb_table"."version" > 0),
	CONSTRAINT "ck_fnb_table__code" CHECK (code ~ '^[A-Za-z0-9\-_.]{1,10}$'),
	CONSTRAINT "ck_fnb_table__area_len" CHECK ("fnb_table"."area" IS NULL OR char_length("fnb_table"."area") <= 40),
	CONSTRAINT "ck_fnb_table__capacity" CHECK ("fnb_table"."capacity" IS NULL OR "fnb_table"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_line_modifier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"modifier_id" uuid,
	"name" text NOT NULL,
	"price_delta" bigint NOT NULL,
	"qty" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "uq_sale_line_modifier__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_sale_line_modifier__name_len" CHECK (char_length("sale_line_modifier"."name") BETWEEN 1 AND 60),
	CONSTRAINT "ck_sale_line_modifier__qty" CHECK ("sale_line_modifier"."qty" >= 1)
);
--> statement-breakpoint
ALTER TABLE "modifier" ADD CONSTRAINT "fk_modifier__group" FOREIGN KEY ("tenant_id","modifier_group_id") REFERENCES "public"."modifier_group"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_group_product" ADD CONSTRAINT "fk_mod_grp_prod__group" FOREIGN KEY ("tenant_id","modifier_group_id") REFERENCES "public"."modifier_group"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_group_product" ADD CONSTRAINT "fk_mod_grp_prod__product" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."product"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_ingredient" ADD CONSTRAINT "fk_modifier_ingredient__modifier" FOREIGN KEY ("tenant_id","modifier_id") REFERENCES "public"."modifier"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_ingredient" ADD CONSTRAINT "fk_modifier_ingredient__ingredient_sku" FOREIGN KEY ("tenant_id","ingredient_sku_id") REFERENCES "public"."sku"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_item" ADD CONSTRAINT "fk_recipe_item__menu_sku" FOREIGN KEY ("tenant_id","menu_sku_id") REFERENCES "public"."sku"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_item" ADD CONSTRAINT "fk_recipe_item__ingredient_sku" FOREIGN KEY ("tenant_id","ingredient_sku_id") REFERENCES "public"."sku"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "fk_bill__table" FOREIGN KEY ("tenant_id","table_id") REFERENCES "public"."fnb_table"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_event" ADD CONSTRAINT "fk_bill_event__bill" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."bill"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__bill" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."bill"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_item" ADD CONSTRAINT "fk_bill_item__created_event" FOREIGN KEY ("tenant_id","created_event_id") REFERENCES "public"."bill_event"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_item_modifier" ADD CONSTRAINT "fk_bill_item_modifier__item" FOREIGN KEY ("tenant_id","bill_item_id") REFERENCES "public"."bill_item"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_modifier" ADD CONSTRAINT "fk_sale_line_modifier__sale_line" FOREIGN KEY ("tenant_id","sale_line_id") REFERENCES "public"."sale_line"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_modifier__group_name" ON "modifier" USING btree ("modifier_group_id",lower("name")) WHERE "modifier"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_modifier__feed" ON "modifier" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_modifier_group__feed" ON "modifier_group" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_modifier_group_product__feed" ON "modifier_group_product" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_modifier_ingredient__mod_sku" ON "modifier_ingredient" USING btree ("modifier_id","ingredient_sku_id") WHERE "modifier_ingredient"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recipe_item__menu_ingredient" ON "recipe_item" USING btree ("menu_sku_id","ingredient_sku_id") WHERE "recipe_item"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_bill__tenant_outlet_status" ON "bill" USING btree ("tenant_id","outlet_id","status");--> statement-breakpoint
CREATE INDEX "ix_bill__tenant_outlet_ref" ON "bill" USING btree ("tenant_id","outlet_id","bill_ref");--> statement-breakpoint
CREATE INDEX "ix_bill__table_open" ON "bill" USING btree ("tenant_id","table_id") WHERE "bill"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "ix_bill__lease_device_open" ON "bill" USING btree ("tenant_id","lease_device_id") WHERE "bill"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "ix_bill__lease_register_open" ON "bill" USING btree ("tenant_id","lease_register_id") WHERE "bill"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "ix_bill_event__tenant_bill_seq" ON "bill_event" USING btree ("tenant_id","bill_id","bill_seq");--> statement-breakpoint
CREATE INDEX "ix_bill_event__tenant_outlet_received" ON "bill_event" USING btree ("tenant_id","outlet_id","received_at");--> statement-breakpoint
CREATE INDEX "ix_bill_item__tenant_bill" ON "bill_item" USING btree ("tenant_id","bill_id");--> statement-breakpoint
CREATE INDEX "ix_bill_item_modifier__tenant_item" ON "bill_item_modifier" USING btree ("tenant_id","bill_item_id");--> statement-breakpoint
CREATE INDEX "ix_fnb_table__feed" ON "fnb_table" USING btree ("tenant_id","outlet_id","version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fnb_table__outlet_code" ON "fnb_table" USING btree ("outlet_id","code") WHERE "fnb_table"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sale_line_modifier__line_mod" ON "sale_line_modifier" USING btree ("sale_line_id","modifier_id") WHERE "sale_line_modifier"."modifier_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_sale_line_modifier__tenant_line" ON "sale_line_modifier" USING btree ("tenant_id","sale_line_id");